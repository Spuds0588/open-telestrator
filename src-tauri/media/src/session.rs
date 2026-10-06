//! One RTMP connection, start to finish: handshake, commands, then frames.
//!
//! Kept apart from [`crate::publisher`] because they answer different questions
//! — this is "what does the protocol require, in what order", and that is "who
//! owns the thread and what is it doing". The split also means the protocol can
//! be driven against an in-memory socket in tests, with no server anywhere.

use crate::amf0::{self, Value};
use crate::chunk::{write_message, ChunkReader, Message};
use crate::flv;
use crate::timing::{Rebaser, Track};
use crate::url::RtmpUrl;
use std::io::{self, Read, Write};
use std::net::TcpStream;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{Receiver, TryRecvError};
use std::time::{Duration, Instant};

use crate::publisher::{Chunk, PublishError};

/// Protocol control message ids.
const MSG_SET_CHUNK_SIZE: u8 = 1;
const MSG_ACK: u8 = 3;
const MSG_WINDOW_ACK_SIZE: u8 = 5;
const MSG_SET_PEER_BANDWIDTH: u8 = 6;
/// An AMF0 command: "connect", "publish", "_result", "onStatus" and friends.
const MSG_COMMAND: u8 = 20;

/// Chunk stream ids. The numbers only have to agree between us and the server,
/// but keeping control, commands, audio and video apart is what lets a reader
/// pick a message apart without carrying extra state for it.
const CSID_CONTROL: u32 = 2;
const CSID_COMMAND: u32 = 3;
const CSID_AUDIO: u32 = 4;
const CSID_VIDEO: u32 = 5;

/// The chunk size we ask the server to accept: big enough that a 1080p keyframe
/// usually fits in one chunk, small enough to stay inside every server's buffer.
const OUTGOING_CHUNK_SIZE: usize = 4096;

/// The receive window we acknowledge. A server that never hears an ack stops
/// sending, and a server that stops sending stops answering us.
const WINDOW_ACK_SIZE: u32 = 2_500_000;

/// How long the pump waits on the socket before looking at its outgoing queue
/// again. Small enough to be imperceptible at 30 fps, large enough to idle.
pub const POLL: Duration = Duration::from_millis(5);

/// Long enough for a slow ingest server to answer, short enough that a wrong
/// hostname is not a hang.
pub const HANDSHAKE_TIMEOUT: Duration = Duration::from_secs(10);

/// Transaction ids for the commands we send, so a reply can be matched to the
/// request that caused it.
const TX_CONNECT: f64 = 1.0;
const TX_RELEASE: f64 = 2.0;
const TX_FC_PUBLISH: f64 = 3.0;
const TX_CREATE_STREAM: f64 = 4.0;
const TX_PUBLISH: f64 = 5.0;

/// Anything the protocol can run over. Implemented for a real socket, and in
/// tests by a scripted one — which is how the handshake and the command
/// sequence are checked without a server.
pub trait Transport: Read + Write + Send {
  /// Set the socket's read timeout. The pump depends on it: with a timeout a
  /// read returns so the outgoing queue gets a turn, without one a read blocks
  /// until the server chooses to speak.
  fn set_read_timeout(&self, timeout: Option<Duration>) -> io::Result<()>;
}

impl Transport for TcpStream {
  fn set_read_timeout(&self, timeout: Option<Duration>) -> io::Result<()> {
    TcpStream::set_read_timeout(self, timeout)
  }
}

pub struct Session {
  transport: Box<dyn Transport>,
  reader: ChunkReader,
  /// Reused scratch so a 30 fps publish does not allocate a buffer per frame.
  outgoing: Vec<u8>,
  read_buffer: Vec<u8>,
  window_ack_size: u32,
  /// Total bytes read, which is what an acknowledgement reports.
  total_in: u32,
  since_ack: u32,
  /// Remembered from `publish` so the closing commands can name the stream.
  stream_name: String,
}

impl Session {
  pub fn new(transport: Box<dyn Transport>) -> Self {
    Session {
      transport,
      reader: ChunkReader::new(),
      outgoing: Vec::with_capacity(OUTGOING_CHUNK_SIZE + 64),
      read_buffer: vec![0u8; 16 * 1024],
      window_ack_size: WINDOW_ACK_SIZE,
      total_in: 0,
      since_ack: 0,
      stream_name: String::new(),
    }
  }

  /// How many bytes have been read in total. Used by the tests to prove the
  /// reader consumes a server's replies.
  pub fn total_in(&self) -> u32 {
    self.total_in
  }

  // --- transport helpers ----------------------------------------------------

  fn write_all(&mut self, bytes: &[u8]) -> Result<(), PublishError> {
    self
      .transport
      .write_all(bytes)
      .and_then(|()| self.transport.flush())
      .map_err(|error| PublishError::Protocol(error.to_string()))
  }

  fn read_exact(&mut self, buffer: &mut [u8]) -> Result<(), PublishError> {
    self
      .transport
      .read_exact(buffer)
      .map(|_| ())
      .map_err(|error| {
        if error.kind() == io::ErrorKind::UnexpectedEof {
          PublishError::Protocol("the ingest server closed the connection".into())
        } else {
          PublishError::Protocol(error.to_string())
        }
      })
  }

  pub fn set_read_timeout(&mut self, timeout: Option<Duration>) -> Result<(), PublishError> {
    self
      .transport
      .set_read_timeout(timeout)
      .map_err(|error| PublishError::Protocol(error.to_string()))
  }

  // --- setup ----------------------------------------------------------------

  /// C0/C1/C2 against S0/S1/S2.
  ///
  /// RTMP's handshake authenticates nothing: a server checks the version byte
  /// and echoes the rest. So the filler here is a counter seeded from the clock
  /// rather than a cryptographic RNG, on purpose — the alternative would suggest
  /// this step proves something it does not.
  pub fn handshake(&mut self) -> Result<(), PublishError> {
    let mut c1 = [0u8; 1536];
    let mut noise = seed();
    for byte in &mut c1 {
      noise = noise
        .wrapping_mul(6364136223846793005)
        .wrapping_add(1442695040888963407);
      *byte = (noise >> 33) as u8;
    }
    // The first four bytes are the time and the next four must be zero; both
    // are left as zero, which is what a server expects from a client that is
    // not tracking its own start time.
    c1[..8].copy_from_slice(&[0u8; 8]);

    let mut out = Vec::with_capacity(1537);
    out.push(3);
    out.extend_from_slice(&c1);
    self.write_all(&out)?;

    let mut s0 = [0u8; 1];
    self.read_exact(&mut s0)?;
    if s0[0] != 3 {
      return Err(PublishError::Handshake(format!(
        "expected RTMP version 3, got {}",
        s0[0]
      )));
    }
    let mut s1 = [0u8; 1536];
    let mut s2 = [0u8; 1536];
    self.read_exact(&mut s1)?;
    self.read_exact(&mut s2)?;

    // C2 echoes S1. It is the whole of our half of the handshake.
    self.write_all(&s1)
  }

  /// The control messages a publisher sends before it says anything else.
  pub fn send_control(&mut self) -> Result<(), PublishError> {
    self.send_message(
      MSG_SET_CHUNK_SIZE,
      0,
      0,
      &(OUTGOING_CHUNK_SIZE as u32).to_be_bytes(),
    )?;
    self.send_message(MSG_WINDOW_ACK_SIZE, 0, 0, &WINDOW_ACK_SIZE.to_be_bytes())?;

    let mut bandwidth = Vec::with_capacity(5);
    bandwidth.extend_from_slice(&WINDOW_ACK_SIZE.to_be_bytes());
    // Limit type 2: dynamic, so the server may lower it if it has to.
    bandwidth.push(2);
    self.send_message(MSG_SET_PEER_BANDWIDTH, 0, 0, &bandwidth)
  }

  /// `connect`, and the answer to it.
  pub fn connect_app(&mut self, url: &RtmpUrl) -> Result<(), PublishError> {
    let command = vec![
      Value::String("connect".into()),
      Value::Number(TX_CONNECT),
      Value::Object(vec![
        ("app".into(), Value::String(url.app.clone())),
        (
          "flashVer".into(),
          Value::String("FMLE/3.0 (compatible; OpenTelestrator)".into()),
        ),
        ("tcUrl".into(), Value::String(url.tc_url())),
        ("fpad".into(), Value::Boolean(false)),
        ("capabilities".into(), Value::Number(15.0)),
        ("audioCodecs".into(), Value::Number(4071.0)),
        // 252 is the H.264 bit; without it a server may assume there is no video.
        ("videoCodecs".into(), Value::Number(252.0)),
        ("videoFunction".into(), Value::Number(1.0)),
        ("objectEncoding".into(), Value::Number(0.0)),
      ]),
    ];
    self.send_command(0, &command)?;
    self.await_transaction(TX_CONNECT, "_result")?;
    Ok(())
  }

  /// `releaseStream`, `FCPublish` and `createStream`, returning the stream id
  /// the server hands back.
  ///
  /// The first two are courtesy calls the Flash Media Encoder made. Servers that
  /// do not know them ignore them; servers that do use them to release a stale
  /// publish under the same name, which is exactly what reconnecting after a
  /// dropped broadcast needs.
  pub fn create_stream(&mut self, name: &str) -> Result<u32, PublishError> {
    self.send_command(
      0,
      &[
        Value::String("releaseStream".into()),
        Value::Number(TX_RELEASE),
        Value::Null,
        Value::String(name.to_string()),
      ],
    )?;
    self.send_command(
      0,
      &[
        Value::String("FCPublish".into()),
        Value::Number(TX_FC_PUBLISH),
        Value::Null,
        Value::String(name.to_string()),
      ],
    )?;
    self.send_command(
      0,
      &[Value::String("createStream".into()), Value::Number(TX_CREATE_STREAM), Value::Null],
    )?;

    let values = self.await_transaction(TX_CREATE_STREAM, "_result")?;
    // The stream id is the fourth value: after the command name, the
    // transaction id and the null command object.
    let stream_id = values
      .get(3)
      .and_then(|value| match value {
        Value::Number(number) => Some(*number as u32),
        _ => None,
      })
      .ok_or_else(|| {
        PublishError::Protocol("the server did not say which stream to publish to".into())
      })?;
    Ok(stream_id)
  }

  /// `publish`, and the `onStatus` that accepts or refuses it. This is where a
  /// wrong stream key is reported, which is why it waits rather than assuming.
  pub fn publish(&mut self, stream_id: u32, name: &str) -> Result<(), PublishError> {
    self.stream_name = name.to_string();
    self.send_command(
      stream_id,
      &[
        Value::String("publish".into()),
        Value::Number(TX_PUBLISH),
        Value::Null,
        Value::String(name.to_string()),
        // "live" asks the server not to record the publish; a platform records
        // it on its own terms either way.
        Value::String("live".into()),
      ],
    )?;

    let deadline = Instant::now() + HANDSHAKE_TIMEOUT;
    loop {
      let values = self.await_command(deadline)?;
      let Some(Value::String(command)) = values.first() else {
        continue;
      };
      match command.as_str() {
        "onStatus" => {
          let code = describe(&values);
          if code.starts_with("NetStream.Publish.Start") {
            return Ok(());
          }
          return Err(PublishError::Rejected(code));
        }
        // A server that refuses mid-setup may answer the publish with an error
        // rather than a status.
        "_error" => return Err(PublishError::Rejected(describe(&values))),
        _ => continue,
      }
    }
  }

  // --- the pump -------------------------------------------------------------

  /// Feed frames until stopped, the queue closes, or the connection breaks.
  ///
  /// Both directions are handled on this one thread: the read has a short
  /// timeout, so a quiet server costs a poll rather than a blocked writer.
  pub fn run(
    &mut self,
    stream_id: u32,
    receiver: &Receiver<Chunk>,
    stopping: &AtomicBool,
  ) -> Result<(), String> {
    let mut rebaser = Rebaser::new();
    loop {
      if stopping.load(Ordering::SeqCst) {
        self.finish(stream_id);
        return Ok(());
      }

      loop {
        match receiver.try_recv() {
          Ok(chunk) => self.send_chunk(stream_id, chunk, &mut rebaser)?,
          Err(TryRecvError::Empty) => break,
          Err(TryRecvError::Disconnected) => {
            self.finish(stream_id);
            return Ok(());
          }
        }
      }

      match self.transport.read(&mut self.read_buffer) {
        Ok(0) => return Err("The platform closed the connection.".into()),
        Ok(read) => {
          let (total, since) = (
            self.total_in.wrapping_add(read as u32),
            self.since_ack + read as u32,
          );
          self.total_in = total;
          self.since_ack = since;
          let chunk = std::mem::take(&mut self.read_buffer);
          self.reader.push(&chunk[..read]);
          self.read_buffer = chunk;

          while let Some(message) = self.reader.next() {
            if self.handle_control(&message) {
              continue;
            }
            self.inspect(&message)?;
          }
          if self.since_ack >= self.window_ack_size {
            self.send_ack()?;
          }
        }
        Err(error)
          if error.kind() == io::ErrorKind::WouldBlock
            || error.kind() == io::ErrorKind::TimedOut
            || error.kind() == io::ErrorKind::Interrupted => {}
        Err(error) => return Err(format!("The stream stopped: {error}")),
      }
    }
  }

  /// Tell the platform the stream is over before the socket closes. Failures are
  /// ignored: the connection is being torn down either way.
  fn finish(&mut self, stream_id: u32) {
    let name = self.stream_name.clone();
    let _ = self.send_command(
      stream_id,
      &[
        Value::String("FCUnpublish".into()),
        Value::Number(6.0),
        Value::Null,
        Value::String(name),
      ],
    );
    let _ = self.send_command(
      0,
      &[
        Value::String("deleteStream".into()),
        Value::Number(7.0),
        Value::Null,
        Value::Number(f64::from(stream_id)),
      ],
    );
  }

  /// The `onMetaData` tag, which describes the stream before any frame.
  pub fn send_metadata(&mut self, stream_id: u32, body: &[u8]) -> Result<(), PublishError> {
    self.send_message(flv::TAG_SCRIPT, stream_id, 0, body)
  }

  fn send_chunk(
    &mut self,
    stream_id: u32,
    chunk: Chunk,
    rebaser: &mut Rebaser,
  ) -> Result<(), String> {
    let sent = match chunk {
      // Sequence headers carry timestamp zero: they describe the stream rather
      // than occupy a place in it, and a platform that sees a nonzero one can
      // misplace the first frame.
      Chunk::VideoSequence(description) => {
        let body = flv::avc_sequence_header(&description);
        self.send_message(flv::TAG_VIDEO, stream_id, 0, &body)
      }
      Chunk::AudioSequence(description) => {
        let body = flv::aac_sequence_header(&description);
        self.send_message(flv::TAG_AUDIO, stream_id, 0, &body)
      }
      Chunk::Video {
        data,
        keyframe,
        composition_time,
        timestamp_us,
      } => {
        let timestamp = rebaser.map(Track::Video, timestamp_us);
        let body = flv::avc_frame(&data, keyframe, composition_time);
        self.send_message(flv::TAG_VIDEO, stream_id, timestamp, &body)
      }
      Chunk::Audio { data, timestamp_us } => {
        let timestamp = rebaser.map(Track::Audio, timestamp_us);
        let body = flv::aac_frame(&data);
        self.send_message(flv::TAG_AUDIO, stream_id, timestamp, &body)
      }
    };
    sent.map_err(|error| error.to_string())
  }

  fn send_ack(&mut self) -> Result<(), String> {
    let total = self.total_in.to_be_bytes();
    self.since_ack = 0;
    self
      .send_message(MSG_ACK, 0, 0, &total)
      .map_err(|error| error.to_string())
  }

  // --- messages -------------------------------------------------------------

  fn send_command(&mut self, stream_id: u32, values: &[Value]) -> Result<(), PublishError> {
    let mut payload = Vec::new();
    for value in values {
      amf0::encode(value, &mut payload);
    }
    self.send_message(MSG_COMMAND, stream_id, 0, &payload)
  }

  fn send_message(
    &mut self,
    type_id: u8,
    stream_id: u32,
    timestamp: u32,
    payload: &[u8],
  ) -> Result<(), PublishError> {
    let csid = csid_for(type_id);
    let message = Message {
      csid,
      timestamp,
      type_id,
      stream_id,
      payload: payload.to_vec(),
    };
    let mut outgoing = std::mem::take(&mut self.outgoing);
    outgoing.clear();
    write_message(&mut outgoing, &message, OUTGOING_CHUNK_SIZE);
    let result = self.write_all(&outgoing);
    self.outgoing = outgoing;
    result
  }

  /// The next command message's values, whatever it is.
  fn await_command(&mut self, deadline: Instant) -> Result<Vec<Value>, PublishError> {
    loop {
      if Instant::now() > deadline {
        return Err(PublishError::Protocol(
          "the ingest server stopped responding".into(),
        ));
      }
      let Some(message) = self.next_message()? else {
        continue;
      };
      if message.type_id != MSG_COMMAND {
        continue;
      }
      return Ok(decode_values(&message.payload));
    }
  }

  /// Wait for `_result` (or `_error`) for one transaction, ignoring replies to
  /// the other commands in flight and anything else the server volunteers.
  fn await_transaction(
    &mut self,
    transaction: f64,
    name: &str,
  ) -> Result<Vec<Value>, PublishError> {
    let deadline = Instant::now() + HANDSHAKE_TIMEOUT;
    loop {
      let values = self.await_command(deadline)?;
      let Some(Value::String(command)) = values.first() else {
        continue;
      };
      if command != name && command != "_error" {
        continue;
      }
      let matches = matches!(values.get(1), Some(Value::Number(id)) if *id == transaction);
      if !matches {
        continue;
      }
      if command == "_error" {
        return Err(PublishError::Rejected(describe(&values)));
      }
      return Ok(values);
    }
  }

  /// One complete message, if the socket has one; otherwise `None`.
  fn next_message(&mut self) -> Result<Option<Message>, PublishError> {
    loop {
      // Messages already in hand come first. One socket read routinely carries
      // several — a server answering `releaseStream`, `FCPublish` and
      // `createStream` in one write is normal — and going back to the socket
      // before draining them would wait for a server that has already said
      // everything it has to say.
      if let Some(message) = self.reader.next() {
        if self.handle_control(&message) {
          continue;
        }
        return Ok(Some(message));
      }

      let read = match self.transport.read(&mut self.read_buffer) {
        Ok(read) => read,
        Err(error) if error.kind() == io::ErrorKind::Interrupted => continue,
        Err(error)
          if error.kind() == io::ErrorKind::WouldBlock
            || error.kind() == io::ErrorKind::TimedOut =>
        {
          return Ok(None)
        }
        Err(error) => return Err(PublishError::Protocol(error.to_string())),
      };
      if read == 0 {
        return Err(PublishError::Protocol(
          "the ingest server closed the connection".into(),
        ));
      }
      self.total_in = self.total_in.wrapping_add(read as u32);
      let chunk = std::mem::take(&mut self.read_buffer);
      self.reader.push(&chunk[..read]);
      self.read_buffer = chunk;
    }
  }

  /// Act on a protocol control message. Returns whether it was one.
  ///
  /// A server is free to change its chunk size at any point, which changes how
  /// every byte after it is framed — the one piece of server state that must
  /// never be dropped on the floor.
  fn handle_control(&mut self, message: &Message) -> bool {
    let window = |payload: &[u8], slot: &mut u32| {
      if let Some(bytes) = payload.get(..4) {
        *slot = u32::from_be_bytes(bytes.try_into().unwrap());
      }
    };
    match message.type_id {
      MSG_SET_CHUNK_SIZE => {
        if let Some(bytes) = message.payload.get(..4) {
          self
            .reader
            .set_chunk_size(u32::from_be_bytes(bytes.try_into().unwrap()) as usize);
        }
        true
      }
      MSG_WINDOW_ACK_SIZE => {
        window(&message.payload, &mut self.window_ack_size);
        true
      }
      MSG_SET_PEER_BANDWIDTH => {
        window(&message.payload, &mut self.window_ack_size);
        true
      }
      MSG_ACK => {
        self.total_in = 0;
        true
      }
      _ => false,
    }
  }

  /// Watch a non-control message for the server saying the publish has ended.
  fn inspect(&mut self, message: &Message) -> Result<(), String> {
    if message.type_id != MSG_COMMAND {
      return Ok(());
    }
    let values = decode_values(&message.payload);
    let Some(Value::String(command)) = values.first() else {
      return Ok(());
    };
    if command == "_error" {
      return Err(format!("The platform rejected the stream: {}", describe(&values)));
    }
    if command != "onStatus" {
      return Ok(());
    }
    let code = describe(&values);
    // "Stop" and "Unpublish" are how a platform says the stream is over; a
    // rejected publish never reaches the pump, but a platform that revokes one
    // mid-stream does, and it is worth saying so rather than appearing fine.
    if code.contains("Failed") || code.contains("Rejected") || code.contains("Unpublish") {
      return Err(format!("The platform stopped the stream: {code}"));
    }
    Ok(())
  }
}

/// Which chunk stream a message type belongs on.
fn csid_for(type_id: u8) -> u32 {
  match type_id {
    MSG_SET_CHUNK_SIZE | MSG_ACK | MSG_WINDOW_ACK_SIZE | MSG_SET_PEER_BANDWIDTH => CSID_CONTROL,
    flv::TAG_AUDIO => CSID_AUDIO,
    flv::TAG_VIDEO => CSID_VIDEO,
    _ => CSID_COMMAND,
  }
}

pub fn decode_values(payload: &[u8]) -> Vec<Value> {
  let mut values = Vec::new();
  let mut rest = payload;
  while !rest.is_empty() {
    match amf0::decode(rest) {
      Some((value, remainder)) => {
        values.push(value);
        rest = remainder;
      }
      // A message we do not fully understand is not a reason to tear down a
      // publish: stop reading it and let the caller decide.
      None => break,
    }
  }
  values
}

/// The most informative word in a status message: the code a platform uses to
/// say what happened, or its description, or the bare status string.
pub fn describe(values: &[Value]) -> String {
  // The code is the canonical name of what happened — it is what a user can
  // search for and what a platform's own docs use — so it wins over a
  // description that merely happens to appear earlier in the message.
  for value in values {
    if let Some(info) = value.get("code").and_then(Value::as_str) {
      return info.to_string();
    }
  }
  for value in values {
    if let Some(description) = value.get("description").and_then(Value::as_str) {
      if !description.is_empty() {
        return description.to_string();
      }
    }
  }
  for value in values {
    if let Some(text) = value.as_str() {
      if text.contains('.') {
        return text.to_string();
      }
    }
  }
  "the platform gave no reason".to_string()
}

/// A seed for the handshake filler. See `handshake` for why this is not a
/// cryptographic source of randomness.
fn seed() -> u64 {
  use std::time::SystemTime;
  SystemTime::now()
    .duration_since(SystemTime::UNIX_EPOCH)
    .map(|elapsed| elapsed.as_nanos() as u64)
    .unwrap_or(0x2545_f491_4f6c_dd1d)
}

#[cfg(test)]
mod tests {
  use super::*;
  use std::sync::mpsc::channel;
  use std::sync::{Arc, Mutex};

  #[derive(Default)]
  struct Wire {
    incoming: Vec<u8>,
    written: Vec<u8>,
    /// When set, running out of incoming bytes looks like the peer hanging up.
    closed: bool,
  }

  /// A socket with no server behind it: replies are queued by the test and
  /// everything sent is kept for inspection.
  #[derive(Clone)]
  struct Mock(Arc<Mutex<Wire>>);

  impl Mock {
    fn new() -> Self {
      Mock(Arc::new(Mutex::new(Wire::default())))
    }

    /// Queue bytes the "server" will send.
    fn feed(&self, bytes: &[u8]) {
      self.0.lock().unwrap().incoming.extend_from_slice(bytes);
    }

    /// Send a scripted AMF0 command message.
    fn feed_command(&self, values: &[Value]) {
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
          stream_id: 0,
          payload,
        },
        4096,
      );
      self.feed(&bytes);
    }

    fn hang_up(&self) {
      self.0.lock().unwrap().closed = true;
    }

    fn written(&self) -> Vec<u8> {
      self.0.lock().unwrap().written.clone()
    }

    fn session(&self) -> Session {
      Session::new(Box::new(self.clone()))
    }
  }

  impl std::io::Read for Mock {
    fn read(&mut self, buffer: &mut [u8]) -> std::io::Result<usize> {
      let mut wire = self.0.lock().unwrap();
      if wire.incoming.is_empty() {
        return Err(if wire.closed {
          std::io::Error::new(std::io::ErrorKind::UnexpectedEof, "hang up")
        } else {
          std::io::Error::new(std::io::ErrorKind::WouldBlock, "nothing yet")
        });
      }
      let take = buffer.len().min(wire.incoming.len());
      buffer[..take].copy_from_slice(&wire.incoming[..take]);
      wire.incoming.drain(..take);
      Ok(take)
    }
  }

  impl std::io::Write for Mock {
    fn write(&mut self, buffer: &[u8]) -> std::io::Result<usize> {
      self.0.lock().unwrap().written.extend_from_slice(buffer);
      Ok(buffer.len())
    }

    fn flush(&mut self) -> std::io::Result<()> {
      Ok(())
    }
  }

  impl Transport for Mock {
    fn set_read_timeout(&self, _timeout: Option<Duration>) -> std::io::Result<()> {
      Ok(())
    }
  }

  /// A server's greeting: version, then two 1536-byte blocks the client has to
  /// read and echo the first of.
  fn greeting() -> Vec<u8> {
    let mut bytes = vec![3u8];
    bytes.extend(std::iter::repeat(0xaa).take(1536));
    bytes.extend(std::iter::repeat(0xbb).take(1536));
    bytes
  }

  fn contains(haystack: &[u8], needle: &[u8]) -> bool {
    haystack.windows(needle.len()).any(|window| window == needle)
  }

  #[test]
  fn handshake_sends_its_half_and_echoes_the_server() {
    let mock = Mock::new();
    mock.feed(&greeting());
    let mut session = mock.session();
    session.handshake().unwrap();

    let written = mock.written();
    assert_eq!(written[0], 3, "C0 is the version byte");
    assert_eq!(&written[1..9], &[0u8; 8], "C1 starts with time and a zero word");
    assert_eq!(written.len(), 1 + 1536 + 1536, "C0 + C1 + C2");
    // C2 is S1, echoed back verbatim.
    assert_eq!(&written[1537..], &vec![0xaa; 1536][..]);
  }

  #[test]
  fn a_server_that_is_not_speaking_rtmp_is_refused_by_name() {
    let mock = Mock::new();
    mock.feed(&[0x99]);
    let mut session = mock.session();
    let error = session.handshake().unwrap_err();
    assert!(matches!(error, PublishError::Handshake(_)), "got {error:?}");
  }

  #[test]
  fn connect_names_the_application_and_is_satisfied_by_its_result() {
    let mock = Mock::new();
    mock.feed_command(&[
      Value::String("_result".into()),
      Value::Number(TX_CONNECT),
      Value::Null,
      Value::Object(vec![("code".into(), Value::String("NetConnection.Connect.Success".into()))]),
    ]);
    let mut session = mock.session();
    let url = crate::url::parse("rtmps://a.rtmp.youtube.com/live2", "key").unwrap();
    session.connect_app(&url).unwrap();

    let written = mock.written();
    assert!(contains(&written, b"connect"));
    assert!(contains(&written, b"live2"), "the application name travels");
    assert!(contains(&written, b"rtmps://a.rtmp.youtube.com:443/live2"));
    // The reply was actually read, not merely sitting in the socket: getting
    // past the transaction wait at all required parsing it.
    assert!(session.total_in() > 0);
  }

  #[test]
  fn connect_reports_an_error_reply_as_a_rejection() {
    let mock = Mock::new();
    mock.feed_command(&[
      Value::String("_error".into()),
      Value::Number(TX_CONNECT),
      Value::Null,
      Value::Object(vec![(
        "description".into(),
        Value::String("Connection refused".into()),
      )]),
    ]);
    let mut session = mock.session();
    let url = crate::url::parse("rtmp://host/live", "key").unwrap();
    let error = session.connect_app(&url).unwrap_err();
    assert_eq!(error, PublishError::Rejected("Connection refused".into()));
  }

  #[test]
  fn create_stream_takes_the_id_out_of_the_result() {
    let mock = Mock::new();
    mock.feed_command(&[
      Value::String("_result".into()),
      Value::Number(TX_CREATE_STREAM),
      Value::Null,
      Value::Number(1.0),
    ]);
    let mut session = mock.session();
    assert_eq!(session.create_stream("key").unwrap(), 1);

    let written = mock.written();
    assert!(contains(&written, b"releaseStream"));
    assert!(contains(&written, b"FCPublish"));
    assert!(contains(&written, b"createStream"));
  }

  #[test]
  fn create_stream_says_so_when_the_server_forgets_the_id() {
    let mock = Mock::new();
    mock.feed_command(&[
      Value::String("_result".into()),
      Value::Number(TX_CREATE_STREAM),
      Value::Null,
    ]);
    let mut session = mock.session();
    assert!(matches!(
      session.create_stream("key"),
      Err(PublishError::Protocol(_))
    ));
  }

  #[test]
  fn the_result_for_another_transaction_is_not_mistaken_for_ours() {
    let mock = Mock::new();
    // A reply to releaseStream arrives first, then the one we are waiting for.
    mock.feed_command(&[
      Value::String("_result".into()),
      Value::Number(TX_RELEASE),
      Value::Null,
    ]);
    mock.feed_command(&[
      Value::String("_result".into()),
      Value::Number(TX_CREATE_STREAM),
      Value::Null,
      Value::Number(2.0),
    ]);
    let mut session = mock.session();
    assert_eq!(session.create_stream("key").unwrap(), 2);
  }

  #[test]
  fn publish_is_accepted_by_its_start_status() {
    let mock = Mock::new();
    mock.feed_command(&[
      Value::String("onStatus".into()),
      Value::Number(0.0),
      Value::Null,
      Value::Object(vec![
        ("level".into(), Value::String("status".into())),
        ("code".into(), Value::String("NetStream.Publish.Start".into())),
      ]),
    ]);
    let mut session = mock.session();
    session.publish(1, "key").unwrap();
    assert!(contains(&mock.written(), b"publish"));
    assert!(contains(&mock.written(), b"live"), "asked for a live publish");
  }

  #[test]
  fn a_bad_stream_key_is_reported_as_a_rejection_naming_the_code() {
    let mock = Mock::new();
    mock.feed_command(&[
      Value::String("onStatus".into()),
      Value::Number(0.0),
      Value::Null,
      Value::Object(vec![
        ("level".into(), Value::String("error".into())),
        ("code".into(), Value::String("NetStream.Publish.BadName".into())),
      ]),
    ]);
    let mut session = mock.session();
    let error = session.publish(1, "wrong-key").unwrap_err();
    assert_eq!(error, PublishError::Rejected("NetStream.Publish.BadName".into()));
  }

  #[test]
  fn the_pump_frames_frames_as_flv_bodies_and_closes_politely() {
    let mock = Mock::new();
    let mut session = mock.session();

    // Queue the frames and close the queue: the first pass sends everything and
    // then sees the channel end, which is the clean-stop path.
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
    sender
      .send(Chunk::AudioSequence(vec![0x11, 0x90]))
      .unwrap();
    sender
      .send(Chunk::Audio {
        data: vec![7, 7],
        timestamp_us: 1_020_000,
      })
      .unwrap();
    drop(sender);

    let stopping = AtomicBool::new(false);
    assert_eq!(session.run(1, &receiver, &stopping), Ok(()));

    let written = mock.written();
    // The AVC sequence header, then a keyframe at timestamp zero followed by one
    // at 20 ms — the rebaser's base comes from the first frame, not the clock.
    assert!(contains(&written, &[0x17, 0x00, 0, 0, 0, 0x01, 0x42, 0xc0, 0x1e]));
    assert!(contains(&written, &[0x17, 0x01, 0, 0, 0, 9, 9, 9]));
    assert!(contains(&written, &[0xaf, 0x00, 0x11, 0x90]));
    assert!(contains(&written, &[0xaf, 0x01, 7, 7]));
    // And the closing courtesies went out on the way down.
    assert!(contains(&written, b"FCUnpublish"));
    assert!(contains(&written, b"deleteStream"));
  }

  #[test]
  fn metadata_goes_out_as_a_script_message() {
    let mock = Mock::new();
    let mut session = mock.session();
    let metadata = crate::flv::metadata_tag(1920, 1080, 30.0, 48_000, 2);
    session.send_metadata(1, &metadata).unwrap();
    let written = mock.written();
    assert!(contains(&written, b"onMetaData"));
    // Basic header, 3-byte timestamp, 3-byte length, then the type id: a data
    // message (18), not a command (20). A server that read this as a command
    // would try to parse the metadata as an RPC call.
    assert_eq!(written[7], flv::TAG_SCRIPT);
  }

  #[test]
  fn a_server_that_revokes_the_publish_mid_stream_stops_the_pump() {
    let mock = Mock::new();
    mock.feed_command(&[
      Value::String("onStatus".into()),
      Value::Number(0.0),
      Value::Null,
      Value::Object(vec![(
        "code".into(),
        Value::String("NetStream.Unpublish.Success".into()),
      )]),
    ]);
    mock.hang_up();
    let mut session = mock.session();
    let (_sender, receiver) = channel();
    let stopping = AtomicBool::new(false);
    let error = session.run(1, &receiver, &stopping).unwrap_err();
    assert!(error.contains("stopped the stream"), "got {error}");
  }

  #[test]
  fn stopping_ends_the_pump_without_an_error() {
    let mock = Mock::new();
    let mut session = mock.session();
    let (_sender, receiver) = channel();
    let stopping = AtomicBool::new(true);
    assert_eq!(session.run(1, &receiver, &stopping), Ok(()));
  }

  #[test]
  fn describe_prefers_the_code_and_falls_back_to_the_description() {
    assert_eq!(
      describe(&[
        Value::Object(vec![(
          "description".into(),
          Value::String("plain words".into())
        )]),
        Value::Object(vec![("code".into(), Value::String("NetStream.X".into()))]),
      ]),
      "NetStream.X"
    );
    assert_eq!(
      describe(&[
        Value::Object(vec![(
          "description".into(),
          Value::String("plain words".into())
        )]),
      ]),
      "plain words"
    );
    assert_eq!(describe(&[Value::Null]), "the platform gave no reason");
  }
}
