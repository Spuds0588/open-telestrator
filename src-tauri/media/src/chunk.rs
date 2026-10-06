//! The RTMP chunk layer: how a message becomes bytes on the wire and back.
//!
//! RTMP sends messages as *chunks*, and a message larger than the agreed chunk
//! size is split across several. Outgoing, everything here uses a type-0 header
//! (the full message header) for a message's first chunk and type 3 for the
//! rest. That is the least clever legal encoding — type 1 and 2 headers exist to
//! compress a repeated header, and at our bitrate the bytes saved are not worth
//! the state — but it is unambiguous, which matters more for a publisher that
//! must not desynchronise mid-broadcast.
//!
//! Incoming is the reverse and has to be tolerant: the server chooses the
//! headers, so all four types, extended timestamps and a chunk size that changes
//! under us are all normal rather than exceptional.

use std::collections::HashMap;

/// The chunk size RTMP starts at, before either side sends a Set Chunk Size.
pub const DEFAULT_CHUNK_SIZE: usize = 128;

/// The largest chunk size the spec allows: a 24-bit length field must stay
/// representable in the header.
pub const MAX_CHUNK_SIZE: usize = 0x00ff_ffff;

/// A message reassembled from one or more chunks.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Message {
  pub csid: u32,
  pub timestamp: u32,
  pub type_id: u8,
  pub stream_id: u32,
  pub payload: Vec<u8>,
}

/// The header state a chunk stream carries forward, so a type-1/2/3 header can
/// be completed from the chunk before it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct Header {
  timestamp: u32,
  length: usize,
  type_id: u8,
  stream_id: u32,
  /// Whether this header's timestamp was sent as an extended timestamp, which
  /// a following type-3 chunk has to repeat.
  extended: bool,
}

/// A message under construction: its header and the bytes gathered so far.
#[derive(Debug)]
struct Partial {
  header: Header,
  payload: Vec<u8>,
}

/// Reassembles messages from a byte stream. Feed it whatever arrives; pull
/// completed messages out until it has none.
#[derive(Debug)]
pub struct ChunkReader {
  /// The incoming chunk size, which the *server* decides for us.
  chunk_size: usize,
  buffer: Vec<u8>,
  headers: HashMap<u32, Header>,
  partials: HashMap<u32, Partial>,
}

impl Default for ChunkReader {
  fn default() -> Self {
    Self::new()
  }
}

impl ChunkReader {
  pub fn new() -> Self {
    ChunkReader {
      chunk_size: DEFAULT_CHUNK_SIZE,
      buffer: Vec::new(),
      headers: HashMap::new(),
      partials: HashMap::new(),
    }
  }

  /// Adopt a chunk size the server announced. Incoming framing changes at once;
  /// messages already mid-flight keep the size they started under.
  pub fn set_chunk_size(&mut self, size: usize) {
    if (1..=MAX_CHUNK_SIZE).contains(&size) {
      self.chunk_size = size;
    }
  }

  pub fn chunk_size(&self) -> usize {
    self.chunk_size
  }

  /// Add bytes that arrived from the socket.
  pub fn push(&mut self, data: &[u8]) {
    self.buffer.extend_from_slice(data);
  }

  /// The next complete message, or `None` when more bytes are needed.
  ///
  /// A truncated or nonsensical chunk stream is reported as `None` forever
  /// rather than as an error: the caller's job is to notice silence, and a
  /// half-received message is not a reason to tear a broadcast down.
  pub fn next(&mut self) -> Option<Message> {
    let mut at = 0usize;
    // A message is consumed one chunk at a time, and a caller that pushes a
    // whole multi-chunk message in one go still has to get it back — so this
    // walks every complete chunk the buffer holds before giving up. Nothing is
    // committed to the reader's state until a chunk's bytes are all present,
    // which is what lets a partly-received chunk be abandoned safely.
    loop {
      let chunk = match self.step(at) {
        Some(chunk) => chunk,
        None => {
          // Out of bytes part way through a message. The chunks that did arrive
          // are already in the partial, so the buffer can let them go and the
          // socket can bring the rest.
          self.buffer.drain(..at);
          return None;
        }
      };
      at = chunk.next_at;

      self.headers.insert(chunk.csid, chunk.header);
      if chunk.fresh {
        // A type 0/1/2 header opens a message, so anything half-read on this
        // chunk stream is abandoned rather than merged into it.
        self.partials.remove(&chunk.csid);
      }
      let partial = self.partials.entry(chunk.csid).or_insert_with(|| Partial {
        header: chunk.header,
        payload: Vec::with_capacity(chunk.header.length),
      });
      partial.header = chunk.header;
      partial.payload.extend_from_slice(&self.buffer[chunk.payload_at..chunk.next_at]);

      if partial.payload.len() < chunk.header.length {
        continue;
      }

      let partial = self.partials.remove(&chunk.csid)?;
      self.buffer.drain(..at);
      return Some(Message {
        csid: chunk.csid,
        timestamp: partial.header.timestamp,
        type_id: partial.header.type_id,
        stream_id: partial.header.stream_id,
        payload: partial.payload,
      });
    }
  }

  /// One chunk's header and the location of its payload, read without changing
  /// any state. `None` means the bytes are not all here yet.
  fn step(&self, at: usize) -> Option<Step> {
    let mut at = at;
    let buffer = &self.buffer;

    // --- basic header -------------------------------------------------------
    let first = *buffer.get(at)?;
    let format = first >> 6;
    let mut csid = u32::from(first & 0x3f);
    at += 1;
    if csid == 0 {
      csid = 64 + u32::from(*buffer.get(at)?);
      at += 1;
    } else if csid == 1 {
      let low = u32::from(*buffer.get(at)?);
      let high = u32::from(*buffer.get(at + 1)?);
      csid = 64 + low + high * 256;
      at += 2;
    }

    // --- message header -----------------------------------------------------
    let previous = self.headers.get(&csid).copied();
    let (mut header, extended_timestamp) = match format {
      0 => {
        let bytes = get(buffer, at, 11)?;
        let timestamp = u24(&bytes[0..3]);
        let length = u24(&bytes[3..6]) as usize;
        let type_id = bytes[6];
        let stream_id = u32::from_le_bytes(bytes[7..11].try_into().unwrap());
        at += 11;
        (
          Header {
            timestamp,
            length,
            type_id,
            stream_id,
            extended: timestamp == 0x00ff_ffff,
          },
          timestamp == 0x00ff_ffff,
        )
      }
      1 => {
        let bytes = get(buffer, at, 7)?;
        let delta = u24(&bytes[0..3]);
        let length = u24(&bytes[3..6]) as usize;
        let type_id = bytes[6];
        at += 7;
        let previous = previous?;
        let (timestamp, extended) = if delta == 0x00ff_ffff {
          (previous.timestamp, true)
        } else {
          (previous.timestamp.wrapping_add(delta), false)
        };
        (
          Header {
            timestamp,
            length,
            type_id,
            stream_id: previous.stream_id,
            extended,
          },
          extended,
        )
      }
      2 => {
        let bytes = get(buffer, at, 3)?;
        let delta = u24(&bytes[0..3]);
        at += 3;
        let previous = previous?;
        let (timestamp, extended) = if delta == 0x00ff_ffff {
          (previous.timestamp, true)
        } else {
          (previous.timestamp.wrapping_add(delta), false)
        };
        (
          Header {
            timestamp,
            extended,
            ..previous
          },
          extended,
        )
      }
      _ => {
        // Type 3 carries no header of its own; it continues the last one.
        let previous = previous?;
        (
          Header {
            extended: previous.extended,
            ..previous
          },
          previous.extended,
        )
      }
    };

    if extended_timestamp {
      let bytes = get(buffer, at, 4)?;
      let value = u32::from_be_bytes(bytes.try_into().unwrap());
      // For a type 0 header the field is the timestamp itself; for a type 1 or 2
      // header it is the delta the 24-bit field could not hold. A type 3 chunk
      // repeats it only to keep the sender's stream aligned, so it is read and
      // discarded.
      match format {
        0 => header.timestamp = value,
        1 | 2 => {
          let previous = previous?;
          header.timestamp = previous.timestamp.wrapping_add(value);
        }
        _ => {}
      }
      at += 4;
    }

    // --- payload ------------------------------------------------------------
    // A message that has already started on this chunk stream is waiting for
    // the rest of itself; a type 0/1/2 header cannot be that, it opens a new
    // message.
    let already = if format == 3 {
      self.partials.get(&csid).map_or(0, |partial| partial.payload.len())
    } else {
      0
    };
    let remaining = header.length.saturating_sub(already);
    let take = remaining.min(self.chunk_size);
    // The whole payload has to be here before anything is committed, so this is
    // the check that decides whether this call does anything at all.
    get(buffer, at, take)?;

    Some(Step {
      csid,
      header,
      payload_at: at,
      next_at: at + take,
      fresh: format != 3,
    })
  }
}

/// One chunk, parsed but not yet applied: where its payload sits, and where the
/// chunk after it begins. Offsets rather than slices, so a caller can go on to
/// mutate the reader while holding this.
#[derive(Debug, Clone, Copy)]
struct Step {
  csid: u32,
  header: Header,
  payload_at: usize,
  next_at: usize,
  /// Whether this chunk's header opens a new message, rather than continuing
  /// the one already under way on this chunk stream.
  fresh: bool,
}

/// Write a message as chunk-framed bytes.
pub fn write_message(out: &mut Vec<u8>, message: &Message, chunk_size: usize) {
  let chunk_size = chunk_size.clamp(1, MAX_CHUNK_SIZE);
  let extended = message.timestamp >= 0x00ff_ffff;
  let header_timestamp = if extended { 0x00ff_ffff } else { message.timestamp };

  let mut first = true;
  let mut offset = 0usize;
  // An empty payload still sends one chunk, carrying just the header.
  loop {
    let take = (message.payload.len() - offset).min(chunk_size);
    if first {
      write_basic_header(out, 0, message.csid);
      out.extend_from_slice(&header_timestamp.to_be_bytes()[1..]);
      out.extend_from_slice(&(message.payload.len() as u32).to_be_bytes()[1..]);
      out.push(message.type_id);
      out.extend_from_slice(&message.stream_id.to_le_bytes());
      if extended {
        out.extend_from_slice(&message.timestamp.to_be_bytes());
      }
    } else {
      write_basic_header(out, 3, message.csid);
      // A continuation of an extended-timestamp message repeats the timestamp.
      if extended {
        out.extend_from_slice(&message.timestamp.to_be_bytes());
      }
    }
    out.extend_from_slice(&message.payload[offset..offset + take]);
    offset += take;
    first = false;
    if offset >= message.payload.len() {
      break;
    }
  }
}

/// The basic header, including the one- and two-byte forms for the larger
/// chunk-stream ids.
fn write_basic_header(out: &mut Vec<u8>, format: u8, csid: u32) {
  if csid < 64 {
    out.push((format << 6) | csid as u8);
  } else if csid < 320 {
    out.push(format << 6);
    out.push((csid - 64) as u8);
  } else {
    out.push((format << 6) | 1);
    let encoded = csid - 64;
    out.push((encoded & 0xff) as u8);
    out.push((encoded >> 8) as u8);
  }
}

fn get(buffer: &[u8], at: usize, count: usize) -> Option<&[u8]> {
  buffer.get(at..at + count)
}

fn u24(bytes: &[u8]) -> u32 {
  (u32::from(bytes[0]) << 16) | (u32::from(bytes[1]) << 8) | u32::from(bytes[2])
}

#[cfg(test)]
mod tests {
  use super::*;

  fn message(csid: u32, type_id: u8, stream_id: u32, payload: Vec<u8>) -> Message {
    Message {
      csid,
      timestamp: 0,
      type_id,
      stream_id,
      payload,
    }
  }

  #[test]
  fn a_short_message_is_one_chunk_with_a_type_zero_header() {
    let mut out = Vec::new();
    write_message(&mut out, &message(3, 20, 0, vec![0xab, 0xcd]), 4096);
    assert_eq!(
      out,
      vec![0x03, 0, 0, 0, 0, 0, 2, 20, 0, 0, 0, 0, 0xab, 0xcd]
    );
  }

  #[test]
  fn a_long_message_splits_into_type_three_continuations() {
    let payload = vec![7u8; 10];
    let mut out = Vec::new();
    write_message(&mut out, &message(4, 9, 1, payload), 4);
    // One basic byte + the 11-byte message header + 4 payload, then two
    // continuations of 4 and 2 bytes, each with only a basic header.
    assert_eq!(out.len(), (1 + 11 + 4) + (1 + 4) + (1 + 2));
    assert_eq!(out[0], 0x04);
    assert_eq!(out[16], 0xc4);
    assert_eq!(out[21], 0xc4);
  }

  #[test]
  fn message_round_trips_through_write_and_read() {
    for csid in [2u32, 3, 64, 300] {
      let original = Message {
        csid,
        timestamp: 12_345,
        type_id: 9,
        stream_id: 1,
        payload: (0..200u32).map(|byte| byte as u8).collect(),
      };
      let mut bytes = Vec::new();
      write_message(&mut bytes, &original, 4096);
      let mut reader = ChunkReader::new();
      // Both sides have to agree on the chunk size; on a real connection the
      // server's Set Chunk Size message is where the reader learns it.
      reader.set_chunk_size(4096);
      reader.push(&bytes);
      assert_eq!(reader.next(), Some(original), "csid {csid}");
      assert_eq!(reader.next(), None);
    }
  }

  #[test]
  fn reader_reassembles_a_message_split_across_chunks() {
    let original = Message {
      csid: 5,
      timestamp: 7,
      type_id: 9,
      stream_id: 1,
      payload: (0..5000u32).map(|byte| byte as u8).collect(),
    };
    let mut bytes = Vec::new();
    write_message(&mut bytes, &original, 128);

    // Feed it in dribs and drabs: nothing until the last byte, then the whole
    // message, exactly as a socket read loop sees it.
    let mut reader = ChunkReader::new();
    let mut delivered = None;
    for byte in &bytes {
      reader.push(std::slice::from_ref(byte));
      if let Some(next) = reader.next() {
        assert!(delivered.is_none(), "only one message was sent");
        delivered = Some(next);
      }
    }
    assert_eq!(delivered, Some(original));
  }

  #[test]
  fn reader_handles_several_messages_arriving_together() {
    let mut bytes = Vec::new();
    write_message(&mut bytes, &message(2, 1, 0, vec![0, 0, 16, 0]), 4096);
    write_message(&mut bytes, &message(3, 20, 0, vec![1, 2, 3]), 4096);
    let mut reader = ChunkReader::new();
    reader.push(&bytes);
    assert_eq!(reader.next().unwrap().type_id, 1);
    assert_eq!(reader.next().unwrap().payload, vec![1, 2, 3]);
    assert_eq!(reader.next(), None);
  }

  #[test]
  fn an_extended_timestamp_is_repeated_on_continuations() {
    let original = Message {
      csid: 4,
      timestamp: 0x0100_0000,
      type_id: 9,
      stream_id: 1,
      payload: vec![9u8; 10],
    };
    let mut bytes = Vec::new();
    write_message(&mut bytes, &original, 4);
    // The 3-byte field carries the escape value, with the real one behind it:
    // basic header, timestamp, length, type, stream id (12 bytes) then it.
    assert_eq!(&bytes[1..4], &[0xff, 0xff, 0xff]);
    assert_eq!(&bytes[12..16], &0x0100_0000u32.to_be_bytes());
    // Each continuation repeats it, straight after its basic header.
    let continuation = 1 + 11 + 4 + 4;
    assert_eq!(
      &bytes[continuation + 1..continuation + 5],
      &0x0100_0000u32.to_be_bytes()
    );

    let mut reader = ChunkReader::new();
    reader.set_chunk_size(4);
    reader.push(&bytes);
    assert_eq!(reader.next(), Some(original));
  }

  #[test]
  fn a_type_one_header_inherits_the_timestamp_and_stream_id() {
    // Type 0 sets up the stream, type 1 then changes only the length.
    let mut bytes = Vec::new();
    write_message(
      &mut bytes,
      &Message {
        csid: 3,
        timestamp: 100,
        type_id: 20,
        stream_id: 1,
        payload: vec![1],
      },
      4096,
    );
    // fmt 1, csid 3; a timestamp delta of 40, length 1, type 20.
    bytes.extend_from_slice(&[0x43, 0, 0, 40, 0, 0, 1, 20, 0xee]);
    let mut reader = ChunkReader::new();
    reader.push(&bytes);
    assert_eq!(reader.next().unwrap().timestamp, 100);
    let second = reader.next().unwrap();
    assert_eq!(second.timestamp, 140);
    assert_eq!(second.stream_id, 1);
    assert_eq!(second.payload, vec![0xee]);
  }

  #[test]
  fn a_type_three_chunk_continues_the_previous_message_header() {
    let mut bytes = Vec::new();
    // Three bytes of payload in 1-byte chunks: one type-0 then two type-3.
    write_message(&mut bytes, &message(4, 8, 1, vec![1, 2, 3]), 1);
    let mut reader = ChunkReader::new();
    reader.set_chunk_size(1);
    reader.push(&bytes);
    let decoded = reader.next().unwrap();
    assert_eq!(decoded.payload, vec![1, 2, 3]);
    assert_eq!(decoded.type_id, 8);
    assert_eq!(decoded.csid, 4);
  }

  #[test]
  fn the_chunk_size_the_server_announces_changes_incoming_framing() {
    // A 200-byte message framed at 128 is two chunks; told the server uses 4096
    // the same bytes are a single chunk.
    let original = message(5, 9, 1, vec![3u8; 200]);
    let mut bytes = Vec::new();
    write_message(&mut bytes, &original, 4096);

    let mut reader = ChunkReader::new();
    assert_eq!(reader.chunk_size(), DEFAULT_CHUNK_SIZE);
    reader.set_chunk_size(4096);
    assert_eq!(reader.chunk_size(), 4096);
    reader.push(&bytes);
    assert_eq!(reader.next(), Some(original));

    // Nonsense sizes are ignored rather than corrupting the reader.
    reader.set_chunk_size(0);
    reader.set_chunk_size(MAX_CHUNK_SIZE + 1);
    assert_eq!(reader.chunk_size(), 4096);
  }

  #[test]
  fn a_truncated_chunk_stream_returns_nothing_rather_than_panicking() {
    let mut reader = ChunkReader::new();
    reader.push(&[0x03, 0, 0]);
    assert_eq!(reader.next(), None);
    // An impossible length field just waits for bytes that will never come.
    reader.push(&[0, 0, 255, 20, 0, 0, 0, 0]);
    assert_eq!(reader.next(), None);
    assert_eq!(ChunkReader::new().next(), None);
  }

  #[test]
  fn an_empty_payload_still_produces_a_message() {
    let mut bytes = Vec::new();
    write_message(&mut bytes, &message(2, 3, 0, Vec::new()), 4096);
    let mut reader = ChunkReader::new();
    reader.push(&bytes);
    let decoded = reader.next().unwrap();
    assert_eq!(decoded.payload, Vec::<u8>::new());
    assert_eq!(decoded.type_id, 3);
  }
}
