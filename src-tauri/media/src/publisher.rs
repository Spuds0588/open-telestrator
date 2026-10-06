//! The handle the app holds while a stream is going out.
//!
//! Setup happens on the calling thread so that "the key is wrong" is answered by
//! the click that started it, rather than by a status the UI has to poll for.
//! Once the platform has accepted the publish, one thread owns the socket and
//! the encoded frames queue into it.

use crate::session::{Session, POLL, HANDSHAKE_TIMEOUT};
use crate::url::RtmpUrl;
use std::fmt;
use std::net::{TcpStream, ToSocketAddrs};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{self, Sender};
use std::sync::{Arc, Mutex};
use std::thread::{self, JoinHandle};
use std::time::Duration;

/// Dialling is allowed to be slower than an answer, but not unbounded.
const CONNECT_TIMEOUT: Duration = Duration::from_secs(10);

/// What the publisher is doing, for the rail to show and for the app to stop a
/// broadcast on.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Status {
  /// Connected, accepted, and pushing frames.
  Publishing,
  /// Finished cleanly, by request.
  Stopped,
  /// Ended on its own, with the reason to show the user.
  Failed(String),
}

impl Status {
  /// Whether the publisher is still pushing frames.
  pub fn is_live(&self) -> bool {
    matches!(self, Status::Publishing)
  }

  /// The reason to show, if there is one.
  pub fn failure(&self) -> Option<&str> {
    match self {
      Status::Failed(reason) => Some(reason),
      _ => None,
    }
  }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PublishError {
  /// The ingest address could not be dialled at all.
  Connect(String),
  /// Something was connected to, but it is not speaking RTMP.
  Handshake(String),
  /// The connection was made but could not be encrypted — an `rtmps://` ingest
  /// whose certificate we would not accept, or whose handshake failed. Never a
  /// falling back to the clear: an address that asks for TLS gets TLS or an
  /// error.
  Tls(String),
  /// The server answered, and said no.
  Rejected(String),
  /// The connection broke before publishing started.
  Protocol(String),
}

impl fmt::Display for PublishError {
  fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
    match self {
      PublishError::Connect(detail) => write!(f, "Could not reach the ingest server: {detail}"),
      PublishError::Handshake(detail) => {
        write!(f, "The ingest server refused the handshake: {detail}")
      }
      PublishError::Tls(detail) => write!(f, "The encrypted connection failed: {detail}"),
      PublishError::Rejected(detail) => write!(f, "The platform rejected the stream: {detail}"),
      PublishError::Protocol(detail) => write!(f, "The connection dropped during setup: {detail}"),
    }
  }
}

impl std::error::Error for PublishError {}

/// What the platform is told about the picture and the sound before any frame.
#[derive(Debug, Clone, Copy)]
pub struct StartOptions {
  pub width: u32,
  pub height: u32,
  pub frame_rate: f64,
  pub audio_sample_rate: u32,
  pub audio_channels: u32,
}

impl Default for StartOptions {
  fn default() -> Self {
    StartOptions {
      width: 1920,
      height: 1080,
      frame_rate: 30.0,
      audio_sample_rate: 48_000,
      audio_channels: 2,
    }
  }
}

/// A unit of the program, already encoded by the webview.
#[derive(Debug, Clone)]
pub enum Chunk {
  /// The AVCDecoderConfigurationRecord, which must precede any video frame.
  VideoSequence(Vec<u8>),
  /// The AudioSpecificConfig, which must precede any audio frame.
  AudioSequence(Vec<u8>),
  Video {
    data: Vec<u8>,
    keyframe: bool,
    /// Presentation time minus decode time, in milliseconds.
    composition_time: i32,
    /// Microseconds since the program started, from the encoder.
    timestamp_us: i64,
  },
  Audio {
    data: Vec<u8>,
    timestamp_us: i64,
  },
}

/// Connect, handshake and publish, returning once the platform has accepted the
/// stream. Errors are synchronous: this is the point at which a bad key is
/// discovered, and the user should hear about it at once.
pub fn start(url: &RtmpUrl, options: StartOptions) -> Result<Publisher, PublishError> {
  let transport = connect(url)?;
  let mut session = Session::new(transport);
  session.set_read_timeout(Some(HANDSHAKE_TIMEOUT))?;
  session.handshake()?;
  session.send_control()?;
  session.connect_app(url)?;
  let stream_id = session.create_stream(&url.stream_name)?;
  session.publish(stream_id, &url.stream_name)?;

  // Metadata before any frame: it is what a platform uses to describe the
  // stream and what a recorder needs to play the result back.
  let metadata = crate::flv::metadata_tag(
    options.width,
    options.height,
    options.frame_rate,
    options.audio_sample_rate,
    options.audio_channels,
  );
  session.send_metadata(stream_id, &metadata)?;

  // From here the socket is read on a short timeout so the pump can alternate.
  session.set_read_timeout(Some(POLL))?;

  let (sender, receiver) = mpsc::channel();
  let status = Arc::new(Mutex::new(Status::Publishing));
  let stopping = Arc::new(AtomicBool::new(false));
  let thread_status = Arc::clone(&status);
  let thread_stopping = Arc::clone(&stopping);

  let thread = thread::spawn(move || {
    let outcome = session.run(stream_id, &receiver, &thread_stopping);
    let next = match outcome {
      Ok(()) => Status::Stopped,
      Err(reason) => Status::Failed(reason),
    };
    if let Ok(mut current) = thread_status.lock() {
      *current = next;
    }
  });

  Ok(Publisher {
    sender: Some(sender),
    status,
    stopping,
    thread: Some(thread),
  })
}

/// Dial the ingest address: TLS when the address asks for it, plain otherwise.
///
/// An `rtmps://` address is never downgraded to the clear — a platform that
/// publishes an encrypted ingest only is not reachable without it, and quietly
/// sending a stream key in the open would be the one outcome worse than failing.
fn connect(url: &RtmpUrl) -> Result<Box<dyn crate::session::Transport>, PublishError> {
  if url.secure {
    // Built per connection rather than cached: it is a handful of allocations
    // beside a DNS lookup and a TLS handshake, and a stream-out happens once.
    let config = crate::tls::client_config().map_err(|error| PublishError::Tls(error.to_string()))?;
    return crate::tls::connect(&config, &url.host, url.port, CONNECT_TIMEOUT)
      .map(|stream| Box::new(stream) as Box<dyn crate::session::Transport>)
      .map_err(|error| match error {
        crate::tls::TlsError::Dial(detail) => PublishError::Connect(detail),
        other => PublishError::Tls(other.to_string()),
      });
  }

  let address = format!("{}:{}", url.host, url.port);
  let resolved = address
    .to_socket_addrs()
    .map_err(|error| PublishError::Connect(error.to_string()))?
    .next()
    .ok_or_else(|| PublishError::Connect(format!("{address} did not resolve")))?;

  let socket = TcpStream::connect_timeout(&resolved, CONNECT_TIMEOUT)
    .map_err(|error| PublishError::Connect(error.to_string()))?;
  // Video arrives in bursts around each keyframe; a small send buffer would turn
  // every one into a stall.
  let _ = socket.set_nodelay(true);

  Ok(Box::new(socket))
}

/// Handed back to the caller: the sink frames go into, plus what the publisher
/// is doing.
pub struct Publisher {
  sender: Option<Sender<Chunk>>,
  status: Arc<Mutex<Status>>,
  stopping: Arc<AtomicBool>,
  thread: Option<JoinHandle<()>>,
}

impl Publisher {
  /// Queue an encoded frame. `false` means the publisher has already stopped, so
  /// the caller should stop feeding it and say so.
  pub fn send(&self, chunk: Chunk) -> bool {
    match &self.sender {
      Some(sender) => sender.send(chunk).is_ok(),
      None => false,
    }
  }

  pub fn status(&self) -> Status {
    self
      .status
      .lock()
      .map(|status| status.clone())
      .unwrap_or(Status::Stopped)
  }

  /// Finish, telling the platform the stream is over before the socket closes.
  /// The thread is joined, so a stop followed immediately by a start cannot race
  /// the connection that is being torn down.
  pub fn stop(&mut self) {
    self.stopping.store(true, Ordering::SeqCst);
    // Dropping the sender is the second signal: it wakes a pump that is idle
    // rather than blocked in a read.
    self.sender = None;
    if let Some(thread) = self.thread.take() {
      let _ = thread.join();
    }
  }
}

impl Drop for Publisher {
  fn drop(&mut self) {
    self.stop();
  }
}
