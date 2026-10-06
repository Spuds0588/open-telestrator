//! TLS, so an `rtmps://` ingest can be reached at all.
//!
//! Facebook Live, Instagram and LinkedIn publish an encrypted ingest and nothing
//! else, so before this file existed three of the platforms people actually
//! stream to were unreachable. The rest of the publisher already understood a
//! secure address — [`crate::url`] carries `secure` and defaults the port to 443
//! — so what was missing was only the socket.
//!
//! # Why two dependencies
//!
//! The crate hand-rolls its protocol, its container and its clock, and it can
//! because those are finite and testable. TLS is neither: a record layer, three
//! versions of key schedule, and a trust store are not something to reimplement.
//! So `rustls` supplies the records and `webpki-roots` supplies Mozilla's roots
//! compiled into the binary — no system trust store is consulted, so a platform's
//! certificate is judged the same way on every machine the app runs on. `ring` is
//! the crypto provider rather than rustls's default `aws-lc-rs`, because it builds
//! with a C compiler and nothing more.
//!
//! # The shape of the connection
//!
//! A TLS record cannot be interrupted halfway and resumed later: a read that was
//! timed out mid-record either loses bytes or corrupts the record layer's idea of
//! where it is. The pump in [`crate::session`] reads on a short timeout so it can
//! alternate between reading and writing frames, which is exactly the pattern
//! that breaks. So the socket is not read by the pump here at all:
//!
//! - one **reader thread** owns the socket's read side, blocks on it with no
//!   timeout, and pushes decrypted bytes into a channel;
//! - the pump's `read` waits on that channel for its timeout and reports
//!   `WouldBlock` when it is empty, which is precisely the behaviour it already
//!   expects from a plain socket;
//! - writes go out inline, on whatever thread owns the pump, because the record
//!   layer must not interleave two writers.
//!
//! The `ClientConnection` is shared by both sides behind a mutex, and no blocking
//! socket call is ever made while holding it: the reader feeds `read_tls` from a
//! slice it has already read, and a write is encrypted into a buffer under the
//! lock and handed to the socket after the lock is dropped. That is what keeps
//! the two threads from deadlocking over a full send buffer.

use rustls::pki_types::ServerName;
use rustls::{ClientConfig, ClientConnection, RootCertStore};
use std::cell::Cell;
use std::fmt;
use std::io::{self, Read, Write};
use std::net::{Shutdown, TcpStream, ToSocketAddrs};
use std::sync::mpsc::{self, Receiver, RecvTimeoutError, Sender};
use std::sync::{Arc, Mutex, MutexGuard};
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};

use crate::session::{Transport, POLL};

/// One socket read. A TLS record tops out just under 16 KiB, so this reads a
/// whole record in one call rather than tearing it across two.
const SCRATCH: usize = 16 * 1024;

/// How often the handshake lets go of the socket to check its own deadline. The
/// handshake is a blocking exchange on the calling thread, so this is the only
/// thing that makes the timeout a timeout rather than a suggestion.
const HANDSHAKE_POLL: Duration = Duration::from_millis(500);

/// What the peer said when it closed, or what broke. Sent by the reader thread
/// so the pump can report a reason rather than a bare end of file.
const CLOSED: &str = "the ingest server closed the connection";

/// Anything that stopped the encrypted connection being usable.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TlsError {
  /// The host could not be dialled, or is not a name a certificate can be
  /// checked against.
  Dial(String),
  /// The handshake did not complete.
  Handshake(String),
  /// The certificate the ingest server presented was not trusted for that name.
  /// Its own variant because it is the one the user can act on — it usually means
  /// a captive portal or a proxy is sitting in the path.
  Certificate(String),
}

impl fmt::Display for TlsError {
  fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
    match self {
      TlsError::Dial(detail) => write!(f, "{detail}"),
      TlsError::Handshake(detail) => write!(f, "{detail}"),
      TlsError::Certificate(detail) => write!(f, "{detail}"),
    }
  }
}

impl std::error::Error for TlsError {}

/// A client configuration trusting the roots that ship in this binary.
///
/// A self-hosted ingest can be reached by building a configuration over its own
/// issuer with [`config_with_roots`] instead; nothing else about the connection
/// changes.
pub fn client_config() -> Result<Arc<ClientConfig>, TlsError> {
  let mut roots = RootCertStore::empty();
  roots.extend(webpki_roots::TLS_SERVER_ROOTS.iter().cloned());
  config_with_roots(roots)
}

/// A client configuration over a caller-supplied trust store, for tests and for
/// an ingest whose certificate is issued by something the public roots do not
/// vouch for.
pub fn config_with_roots(roots: RootCertStore) -> Result<Arc<ClientConfig>, TlsError> {
  // The provider is named rather than picked up from a process-wide default, so
  // nothing else in the process can change how this negotiates.
  let provider = Arc::new(rustls::crypto::ring::default_provider());
  let config = ClientConfig::builder_with_provider(provider)
    .with_safe_default_protocol_versions()
    .map_err(|error| {
      TlsError::Handshake(format!("this build could not configure TLS: {error}"))
    })?
    .with_root_certificates(roots)
    .with_no_client_auth();
  Ok(Arc::new(config))
}

/// Dial an encrypted ingest, complete the handshake, and hand back a stream the
/// pump can drive.
///
/// The handshake happens here, on the calling thread, so that an untrusted
/// certificate is reported by the click that started the stream rather than by a
/// status nobody is reading.
pub fn connect(
  config: &Arc<ClientConfig>,
  host: &str,
  port: u16,
  timeout: Duration,
) -> Result<TlsStream, TlsError> {
  let name = ServerName::try_from(host.to_string()).map_err(|_| {
    TlsError::Dial(format!("{host} is not a name a certificate can be checked against"))
  })?;

  let address = format!("{host}:{port}");
  let resolved = address
    .to_socket_addrs()
    .map_err(|error| TlsError::Dial(error.to_string()))?
    .next()
    .ok_or_else(|| TlsError::Dial(format!("{address} did not resolve")))?;

  let mut socket = TcpStream::connect_timeout(&resolved, timeout)
    .map_err(|error| TlsError::Dial(error.to_string()))?;
  // Same reason as the plain socket: video arrives in bursts around a keyframe.
  let _ = socket.set_nodelay(true);
  socket
    .set_read_timeout(Some(HANDSHAKE_POLL))
    .map_err(|error| TlsError::Dial(error.to_string()))?;

  let mut connection = ClientConnection::new(Arc::clone(config), name)
    .map_err(|error| TlsError::Handshake(error.to_string()))?;

  let deadline = Instant::now() + timeout;
  while connection.is_handshaking() {
    match connection.complete_io(&mut socket) {
      Ok(_) => {}
      Err(error) if error.kind() == io::ErrorKind::WouldBlock => {}
      Err(error) if error.kind() == io::ErrorKind::Interrupted => {}
      Err(error) => return Err(classify(error)),
    }
    if Instant::now() >= deadline {
      return Err(TlsError::Handshake(format!(
        "the ingest server did not complete a TLS handshake within {}s",
        timeout.as_secs()
      )));
    }
  }

  // Whatever the handshake left queued (a TLS 1.3 ticket, usually) goes out
  // before the reader thread takes the socket over.
  while connection.wants_write() {
    connection
      .write_tls(&mut socket)
      .map_err(|error| TlsError::Handshake(error.to_string()))?;
  }
  socket
    .flush()
    .map_err(|error| TlsError::Handshake(error.to_string()))?;

  // From here the reader thread blocks in a read, so the socket must not carry a
  // timeout: only a socket shutdown can wake it.
  socket
    .set_read_timeout(None)
    .map_err(|error| TlsError::Dial(error.to_string()))?;
  let read_socket = socket
    .try_clone()
    .map_err(|error| TlsError::Dial(error.to_string()))?;

  let connection = Arc::new(Mutex::new(connection));
  let (sender, incoming) = mpsc::channel();
  let reader_connection = Arc::clone(&connection);
  let reader = thread::spawn(move || pump_records(read_socket, reader_connection, sender));

  Ok(TlsStream {
    connection,
    socket,
    incoming,
    reader: Some(reader),
    timeout: Cell::new(POLL),
    pending: Vec::new(),
  })
}

/// An established encrypted connection, as the pump sees it: the same `Read` and
/// `Write` a plain socket offers, on the same timeouts.
pub struct TlsStream {
  /// Shared with the reader thread. Each side touches it only for its own
  /// direction, and never while a socket call is in flight.
  connection: Arc<Mutex<ClientConnection>>,
  /// The write half. Also what wakes the reader thread on the way out.
  socket: TcpStream,
  /// Decrypted bytes from the reader thread, in order.
  incoming: Receiver<Inbound>,
  reader: Option<JoinHandle<()>>,
  /// How long a read waits before reporting `WouldBlock`. Set by the pump: long
  /// during setup, one poll once frames are flowing.
  timeout: Cell<Duration>,
  /// Bytes handed over by the reader thread that did not fit the last read.
  pending: Vec<u8>,
}

/// What the reader thread sends the pump.
enum Inbound {
  Data(Vec<u8>),
  /// The connection is over, with the reason to show.
  Closed(String),
}

impl TlsStream {
  fn lock(&self) -> io::Result<MutexGuard<'_, ClientConnection>> {
    self
      .connection
      .lock()
      .map_err(|_| io::Error::new(io::ErrorKind::Other, "the TLS session was poisoned"))
  }

  /// Encrypt whatever the record layer has queued and put it on the socket.
  ///
  /// The encryption happens under the lock and the socket write after it, so a
  /// slow network cannot block the reader thread out of the session.
  fn send_pending(&mut self) -> io::Result<()> {
    let mut record = Vec::new();
    {
      let mut connection = self.lock()?;
      while connection.wants_write() {
        connection.write_tls(&mut record)?;
      }
    }
    if !record.is_empty() {
      self.socket.write_all(&record)?;
    }
    Ok(())
  }
}

impl Read for TlsStream {
  fn read(&mut self, buffer: &mut [u8]) -> io::Result<usize> {
    if buffer.is_empty() {
      return Ok(0);
    }
    loop {
      if !self.pending.is_empty() {
        let take = buffer.len().min(self.pending.len());
        buffer[..take].copy_from_slice(&self.pending[..take]);
        self.pending.drain(..take);
        // The record layer may have answered the peer while decoding what it
        // sent — a TLS 1.3 key update, most often. Sending it here keeps that
        // bookkeeping moving even while the pump has no frame to write.
        self.send_pending()?;
        return Ok(take);
      }
      match self.incoming.recv_timeout(self.timeout.get()) {
        Ok(Inbound::Data(bytes)) => self.pending = bytes,
        Ok(Inbound::Closed(reason)) => {
          return Err(io::Error::new(io::ErrorKind::ConnectionAborted, reason))
        }
        // Exactly what a socket with a read timeout does, which is what the pump
        // is written against.
        Err(RecvTimeoutError::Timeout) => {
          return Err(io::Error::new(io::ErrorKind::WouldBlock, "the connection is quiet"))
        }
        Err(RecvTimeoutError::Disconnected) => {
          return Err(io::Error::new(
            io::ErrorKind::ConnectionAborted,
            "the connection's reader stopped",
          ))
        }
      }
    }
  }
}

impl Write for TlsStream {
  fn write(&mut self, buffer: &[u8]) -> io::Result<usize> {
    let written = {
      let mut connection = self.lock()?;
      connection.writer().write(buffer)?
    };
    self.send_pending()?;
    Ok(written)
  }

  fn flush(&mut self) -> io::Result<()> {
    self.send_pending()
  }
}

impl Transport for TlsStream {
  fn set_read_timeout(&self, timeout: Option<Duration>) -> io::Result<()> {
    // The socket belongs to the reader thread and stays blocking; what a timeout
    // means here is how long the pump waits on the reader's queue. `None` is the
    // socket's "block forever", which would hang a pump that has frames to send,
    // so a read that has no timeout of its own still polls.
    self.timeout.set(timeout.unwrap_or(POLL));
    Ok(())
  }
}

impl Drop for TlsStream {
  fn drop(&mut self) {
    // The reader thread is parked in a blocking read, so shutting the socket down
    // is the only thing that brings it back. Either duplicate wakes it: the two
    // halves are one socket.
    let _ = self.socket.shutdown(Shutdown::Both);
    if let Some(reader) = self.reader.take() {
      let _ = reader.join();
    }
  }
}

/// The reader thread: read encrypted bytes, decrypt them, hand them over.
///
/// It owns the socket's read side for the life of the connection and never
/// writes to it — the pump is the only writer, which is what keeps two TLS
/// records from being interleaved on the wire.
fn pump_records(
  mut socket: TcpStream,
  connection: Arc<Mutex<ClientConnection>>,
  out: Sender<Inbound>,
) {
  let mut encrypted = vec![0u8; SCRATCH];
  let mut scratch = vec![0u8; SCRATCH];
  loop {
    let read = match socket.read(&mut encrypted) {
      Ok(0) => {
        let _ = out.send(Inbound::Closed(CLOSED.into()));
        return;
      }
      Ok(read) => read,
      Err(error) if error.kind() == io::ErrorKind::Interrupted => continue,
      Err(error) => {
        let _ = out.send(Inbound::Closed(format!("the encrypted connection broke: {error}")));
        return;
      }
    };

    let mut decrypted = Vec::new();
    let mut closed = false;
    {
      let mut connection = match connection.lock() {
        Ok(connection) => connection,
        Err(_) => {
          let _ = out.send(Inbound::Closed("the TLS session was poisoned".into()));
          return;
        }
      };
      // `read_tls` is fed a slice that has already been read, never the socket,
      // so it cannot block while the lock is held.
      let mut source = &encrypted[..read];
      if let Err(error) = connection.read_tls(&mut source) {
        let _ = out.send(Inbound::Closed(format!("the TLS record could not be read: {error}")));
        return;
      }
      if let Err(error) = connection.process_new_packets() {
        let _ = out.send(Inbound::Closed(format!("the encrypted connection failed: {error}")));
        return;
      }
      loop {
        match connection.reader().read(&mut scratch) {
          // A clean close: everything before it has been handed over already.
          Ok(0) => {
            closed = true;
            break;
          }
          Ok(read) => decrypted.extend_from_slice(&scratch[..read]),
          Err(error) if error.kind() == io::ErrorKind::WouldBlock => break,
          Err(error) => {
            let _ = out.send(Inbound::Closed(format!("the encrypted connection failed: {error}")));
            return;
          }
        }
      }
    }

    if !decrypted.is_empty() && out.send(Inbound::Data(decrypted)).is_err() {
      return;
    }
    if closed {
      let _ = out.send(Inbound::Closed(CLOSED.into()));
      return;
    }
  }
}

/// Tell a certificate problem apart from every other handshake failure: it is the
/// one a user can do something about.
fn classify(error: io::Error) -> TlsError {
  let certificate = error
    .get_ref()
    .and_then(|inner| inner.downcast_ref::<rustls::Error>())
    .map(|inner| matches!(inner, rustls::Error::InvalidCertificate(_)))
    .unwrap_or(false);
  let detail = error.to_string();
  if certificate {
    TlsError::Certificate(format!(
      "the ingest server's certificate was not trusted: {detail}"
    ))
  } else {
    TlsError::Handshake(detail)
  }
}

#[cfg(test)]
mod tests {
  use super::*;
  use crate::amf0::{self, Value};
  use crate::chunk::{write_message, ChunkReader, Message};
  use crate::publisher::Chunk;
  use crate::session::{decode_values, Session, HANDSHAKE_TIMEOUT, POLL};
  use rcgen::{
    BasicConstraints, CertificateParams, DnType, ExtendedKeyUsagePurpose, IsCa, Issuer, KeyPair,
    KeyUsagePurpose,
  };
  use rustls::pki_types::{CertificateDer, PrivateKeyDer};
  use rustls::{ServerConfig, ServerConnection, StreamOwned};
  use std::net::TcpListener;
  use std::sync::atomic::AtomicBool;
  use std::sync::mpsc::channel;

  const MSG_SET_CHUNK_SIZE: u8 = 1;
  const MSG_WINDOW_ACK_SIZE: u8 = 5;
  const MSG_SET_PEER_BANDWIDTH: u8 = 6;
  const MSG_COMMAND: u8 = 20;

  /// What the test server writes with: the 128 RTMP starts at, so the client's
  /// reader needs no Set Chunk Size from us before it can parse a reply.
  const SERVER_CHUNK_SIZE: usize = 128;

  /// A test that hangs is worse than one that fails, and a blocking socket has
  /// no other way to say "nothing is coming".
  const PATIENCE: Duration = Duration::from_secs(15);

  /// Everything the server saw, in the order it saw it.
  #[derive(Debug, Clone, Default, PartialEq, Eq)]
  struct Report {
    commands: Vec<String>,
    tags: Vec<&'static str>,
  }

  impl Report {
    fn saw(&self, tag: &str) -> bool {
      self.tags.iter().any(|seen| *seen == tag)
    }
  }

  /// An RTMP server that only speaks TLS, on loopback, with a certificate no
  /// trust store in the world vouches for. It does not pretend to be a platform:
  /// it accepts a publish and records what arrives.
  struct TestServer {
    port: u16,
    /// What a client must trust to verify it. The bundled roots are deliberately
    /// not in it — that is the point of one of the tests.
    roots: RootCertStore,
    report: Arc<Mutex<Report>>,
    handle: Option<JoinHandle<()>>,
  }

  impl TestServer {
    fn start() -> TestServer {
      let (roots, config) = authority();
      let listener = TcpListener::bind("127.0.0.1:0").expect("a loopback port");
      let port = listener.local_addr().unwrap().port();
      let report = Arc::new(Mutex::new(Report::default()));
      let thread_report = Arc::clone(&report);

      let handle = thread::spawn(move || {
        let (socket, _) = match listener.accept() {
          Ok(accepted) => accepted,
          Err(_) => return,
        };
        let _ = socket.set_nodelay(true);
        // A timeout on the socket, so a client that stops talking cannot park
        // this thread inside rustls for the rest of the test run.
        let _ = socket.set_read_timeout(Some(Duration::from_millis(250)));
        let connection = match ServerConnection::new(config) {
          Ok(connection) => connection,
          Err(_) => return,
        };
        let mut stream = StreamOwned::new(connection, socket);
        // A client that refuses our certificate simply hangs up, so the failure
        // is expected here and never asserted on: what the test checks is what
        // the client did, and what the server never saw.
        let _ = accept_publish(&mut stream, &thread_report);
      });

      TestServer {
        port,
        roots,
        report,
        handle: Some(handle),
      }
    }

    fn report(&self) -> Report {
      self.report.lock().unwrap().clone()
    }

    fn join(&mut self) {
      if let Some(handle) = self.handle.take() {
        let _ = handle.join();
      }
    }
  }

  type Client = rustls::StreamOwned<ServerConnection, TcpStream>;

  /// A certificate authority and a leaf for loopback, as a server configuration
  /// plus the roots a client needs to accept it.
  fn authority() -> (RootCertStore, Arc<ServerConfig>) {
    let mut ca_params = CertificateParams::new(Vec::<String>::new()).unwrap();
    ca_params.is_ca = IsCa::Ca(BasicConstraints::Unconstrained);
    ca_params.key_usages = vec![
      KeyUsagePurpose::KeyCertSign,
      KeyUsagePurpose::DigitalSignature,
      KeyUsagePurpose::CrlSign,
    ];
    ca_params
      .distinguished_name
      .push(DnType::CommonName, "open-telestrator test authority");
    let ca_key = KeyPair::generate().unwrap();
    let authority = ca_params.self_signed(&ca_key).unwrap();
    let issuer = Issuer::new(ca_params, ca_key);

    // Both a name and the address the client will actually dial: rustls checks
    // the address against an IP SAN rather than a DNS one.
    let mut leaf_params =
      CertificateParams::new(vec!["localhost".to_string(), "127.0.0.1".to_string()]).unwrap();
    leaf_params
      .distinguished_name
      .push(DnType::CommonName, "localhost");
    leaf_params.key_usages = vec![KeyUsagePurpose::DigitalSignature];
    leaf_params.extended_key_usages = vec![ExtendedKeyUsagePurpose::ServerAuth];
    let leaf_key = KeyPair::generate().unwrap();
    let leaf = leaf_params.signed_by(&leaf_key, &issuer).unwrap();

    let mut roots = RootCertStore::empty();
    roots.add(authority.der().clone()).unwrap();

    let provider = Arc::new(rustls::crypto::ring::default_provider());
    let config = ServerConfig::builder_with_provider(provider)
      .with_safe_default_protocol_versions()
      .unwrap()
      .with_no_client_auth()
      .with_single_cert(
        vec![CertificateDer::from(leaf.der().clone())],
        PrivateKeyDer::Pkcs8(leaf_key.serialize_der().into()),
      )
      .unwrap();
    (roots, Arc::new(config))
  }

  /// The server's half of RTMP, as far as accepting one publish needs.
  fn accept_publish(stream: &mut Client, report: &Arc<Mutex<Report>>) -> io::Result<()> {
    let deadline = Instant::now() + PATIENCE;

    // C0/C1, then S0/S1/S2. RTMP's handshake proves nothing, so the filler is a
    // constant and S1 is the client's own C1 echoed back.
    let mut c0c1 = vec![0u8; 1537];
    read_exact(stream, &mut c0c1, deadline)?;
    let mut greeting = Vec::with_capacity(3073);
    greeting.push(3);
    greeting.extend(std::iter::repeat(0xaa).take(1536));
    greeting.extend_from_slice(&c0c1[1..]);
    stream.write_all(&greeting)?;
    stream.flush()?;
    let mut c2 = vec![0u8; 1536];
    read_exact(stream, &mut c2, deadline)?;

    let mut reader = ChunkReader::new();
    let mut buffer = vec![0u8; 16 * 1024];
    let mut stream_id = 0u32;

    loop {
      let Some(message) = next_message(stream, &mut reader, &mut buffer, deadline)? else {
        return Ok(());
      };
      match message.type_id {
        // What the client tells us to frame its own messages at. Dropping this
        // is how a server desynchronises on the very first keyframe.
        MSG_SET_CHUNK_SIZE => {
          if let Some(bytes) = message.payload.get(..4) {
            reader.set_chunk_size(u32::from_be_bytes(bytes.try_into().unwrap()) as usize);
          }
        }
        MSG_WINDOW_ACK_SIZE | MSG_SET_PEER_BANDWIDTH => {}
        MSG_COMMAND => {
          let values = decode_values(&message.payload);
          let Some(Value::String(command)) = values.first() else {
            continue;
          };
          let command = command.clone();
          report.lock().unwrap().commands.push(command.clone());
          match command.as_str() {
            "connect" => send_command(
              stream,
              0,
              &[
                Value::String("_result".into()),
                transaction(&values),
                Value::Null,
                Value::Object(vec![
                  ("level".into(), Value::String("status".into())),
                  (
                    "code".into(),
                    Value::String("NetConnection.Connect.Success".into()),
                  ),
                ]),
              ],
            )?,
            "createStream" => {
              stream_id = 1;
              send_command(
                stream,
                0,
                &[
                  Value::String("_result".into()),
                  transaction(&values),
                  Value::Null,
                  Value::Number(f64::from(stream_id)),
                ],
              )?;
            }
            "publish" => send_command(
              stream,
              stream_id,
              &[
                Value::String("onStatus".into()),
                Value::Number(0.0),
                Value::Null,
                Value::Object(vec![
                  ("level".into(), Value::String("status".into())),
                  ("code".into(), Value::String("NetStream.Publish.Start".into())),
                ]),
              ],
            )?,
            // The two courtesy calls are answered by being ignored, which is
            // what a platform that does not know them does.
            _ => {}
          }
        }
        crate::flv::TAG_SCRIPT => report.lock().unwrap().tags.push("metadata"),
        crate::flv::TAG_VIDEO => {
          let kind = match message.payload.get(..2) {
            Some([first, packet]) if first & 0x0f == 7 => match packet {
              0 => "video-sequence",
              _ if first >> 4 == 1 => "keyframe",
              _ => "video",
            },
            _ => "video",
          };
          report.lock().unwrap().tags.push(kind);
        }
        crate::flv::TAG_AUDIO => {
          let kind = match message.payload.get(1) {
            Some(0) => "audio-sequence",
            _ => "audio",
          };
          report.lock().unwrap().tags.push(kind);
        }
        _ => {}
      }

      // The publish is over once every frame of the fixture has landed. Going
      // home here is what lets the test finish even though the client is still
      // holding the connection open.
      let seen = report.lock().unwrap();
      if seen.saw("metadata")
        && seen.saw("video-sequence")
        && seen.saw("keyframe")
        && seen.saw("audio-sequence")
        && seen.saw("audio")
      {
        return Ok(());
      }
    }
  }

  fn transaction(values: &[Value]) -> Value {
    values.get(1).cloned().unwrap_or(Value::Number(0.0))
  }

  fn send_command(stream: &mut Client, stream_id: u32, values: &[Value]) -> io::Result<()> {
    let mut payload = Vec::new();
    for value in values {
      amf0::encode(value, &mut payload);
    }
    let mut bytes = Vec::new();
    write_message(
      &mut bytes,
      &Message {
        csid: 3,
        timestamp: 0,
        type_id: MSG_COMMAND,
        stream_id,
        payload,
      },
      SERVER_CHUNK_SIZE,
    );
    stream.write_all(&bytes)?;
    stream.flush()
  }

  fn next_message(
    stream: &mut Client,
    reader: &mut ChunkReader,
    buffer: &mut [u8],
    deadline: Instant,
  ) -> io::Result<Option<Message>> {
    loop {
      if let Some(message) = reader.next() {
        return Ok(Some(message));
      }
      if Instant::now() > deadline {
        return Ok(None);
      }
      match stream.read(buffer) {
        Ok(0) => return Ok(None),
        Ok(read) => reader.push(&buffer[..read]),
        Err(error)
          if matches!(
            error.kind(),
            io::ErrorKind::WouldBlock | io::ErrorKind::TimedOut | io::ErrorKind::Interrupted
          ) => {}
        Err(error) => return Err(error),
      }
    }
  }

  fn read_exact(stream: &mut Client, buffer: &mut [u8], deadline: Instant) -> io::Result<()> {
    let mut filled = 0;
    while filled < buffer.len() {
      if Instant::now() > deadline {
        return Err(io::Error::new(io::ErrorKind::TimedOut, "the client stopped sending"));
      }
      match stream.read(&mut buffer[filled..]) {
        Ok(0) => return Err(io::Error::new(io::ErrorKind::UnexpectedEof, "closed")),
        Ok(read) => filled += read,
        Err(error)
          if matches!(
            error.kind(),
            io::ErrorKind::WouldBlock | io::ErrorKind::TimedOut | io::ErrorKind::Interrupted
          ) => {}
        Err(error) => return Err(error),
      }
    }
    Ok(())
  }

  /// The whole point of the module: a real TLS handshake against a real TLS
  /// server, and then the ordinary RTMP publish arriving over it.
  #[test]
  fn a_publish_survives_a_real_tls_handshake() {
    let mut server = TestServer::start();
    let config = config_with_roots(server.roots.clone()).unwrap();

    let stream = connect(&config, "127.0.0.1", server.port, HANDSHAKE_TIMEOUT)
      .expect("the test authority is trusted");
    let mut session = Session::new(Box::new(stream));
    session.set_read_timeout(Some(HANDSHAKE_TIMEOUT)).unwrap();
    session.handshake().unwrap();
    session.send_control().unwrap();

    // An address of the shape LinkedIn issues: a non-standard port, and the key
    // in the path as well as in its own field.
    let url = crate::url::parse(
      &format!("rtmps://127.0.0.1:{}/live/test-key", server.port),
      "test-key",
    )
    .unwrap();
    session.connect_app(&url).unwrap();
    let stream_id = session.create_stream(&url.stream_name).unwrap();
    session.publish(stream_id, &url.stream_name).unwrap();

    let metadata = crate::flv::metadata_tag(320, 240, 30.0, 44_100, 1);
    session.send_metadata(stream_id, &metadata).unwrap();
    session.set_read_timeout(Some(POLL)).unwrap();

    let (sender, receiver) = channel();
    sender
      .send(Chunk::VideoSequence(vec![0x01, 0x42, 0xc0, 0x1e]))
      .unwrap();
    sender
      .send(Chunk::Video {
        data: vec![9, 9, 9],
        keyframe: true,
        composition_time: 0,
        timestamp_us: 1_000_000,
      })
      .unwrap();
    sender.send(Chunk::AudioSequence(vec![0x11, 0x90])).unwrap();
    sender
      .send(Chunk::Audio {
        data: vec![7, 7],
        timestamp_us: 1_020_000,
      })
      .unwrap();
    drop(sender);

    let stopping = AtomicBool::new(false);
    assert_eq!(session.run(stream_id, &receiver, &stopping), Ok(()));
    drop(session);
    server.join();

    let report = server.report();
    assert_eq!(
      report.commands,
      vec!["connect", "releaseStream", "FCPublish", "createStream", "publish"]
    );
    // Order matters: metadata describes the stream, and a sequence header has to
    // be on the platform's side before any frame it describes.
    assert_eq!(
      report.tags,
      vec![
        "metadata",
        "video-sequence",
        "keyframe",
        "audio-sequence",
        "audio"
      ]
    );
  }

  /// An encrypted ingest whose certificate is not trusted must not be connected
  /// to — and above all must not be published to in the clear.
  #[test]
  fn an_untrusted_certificate_stops_the_connection_rather_than_downgrading_it() {
    let mut server = TestServer::start();
    // The roots a real build uses, against a certificate issued by something
    // none of them vouch for.
    let config = client_config().unwrap();

    let error = match connect(&config, "127.0.0.1", server.port, HANDSHAKE_TIMEOUT) {
      Ok(_) => panic!("a certificate nothing vouches for was accepted"),
      Err(error) => error,
    };
    assert!(matches!(error, TlsError::Certificate(_)), "got {error:?}");

    server.join();
    assert!(
      server.report().commands.is_empty(),
      "nothing may be published to a connection whose certificate was refused"
    );
  }

  #[test]
  fn the_bundled_roots_build_a_configuration() {
    // Proves the two dependency decisions fit together: webpki-roots' anchors
    // parse into rustls's store, and the ring provider negotiates the versions
    // this connection needs.
    let config = client_config().expect("the bundled roots are valid");
    assert!(Arc::strong_count(&config) >= 1);
  }

  #[test]
  fn a_host_that_is_not_a_certificate_name_is_refused_before_dialling() {
    let config = client_config().unwrap();
    let error = match connect(&config, "", 443, HANDSHAKE_TIMEOUT) {
      Ok(_) => panic!("an empty host is not dialled"),
      Err(error) => error,
    };
    assert!(matches!(error, TlsError::Dial(_)), "got {error:?}");
  }
}
