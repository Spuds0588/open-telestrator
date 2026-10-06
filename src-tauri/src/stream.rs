//! Stream-out: pushing the program to an RTMP platform.
//!
//! The webview does the encoding — a browser already has hardware H.264 and,
//! usually, AAC — and hands the *encoded* frames down here, where a Rust thread
//! owns the RTMP socket. Sending encoded frames rather than pixels is what makes
//! the boundary cheap: a few hundred kilobytes a second rather than hundreds of
//! megabytes, so the ordinary IPC channel is plenty.
//!
//! Frames arrive as one raw body per frame, not as a JSON array of numbers: a
//! `Vec<u8>` in an ordinary argument would arrive as `[23,44,31,...]`, five
//! bytes of JSON for every byte of video.

use std::sync::Mutex;
use telestrator_media::{parse_url, start, Chunk, Publisher, StartOptions};

/// The frame wire format, mirrored by `src/lib/frameHeader.ts` and tested on
/// both sides. Every field is big-endian.
///
/// ```text
/// 0        kind
/// 1  .. 9  timestamp, microseconds, i64
/// 9        flags — bit 0 is "this is a keyframe"
/// 10 .. 12 composition time, milliseconds, i16
/// 12 ..    payload
/// ```
pub const FRAME_HEADER_LEN: usize = 12;

pub const KIND_VIDEO_SEQUENCE: u8 = 0;
pub const KIND_AUDIO_SEQUENCE: u8 = 1;
pub const KIND_VIDEO: u8 = 2;
pub const KIND_AUDIO: u8 = 3;

/// One encoded frame, borrowed from the request body.
#[derive(Debug)]
pub struct Frame<'a> {
  pub kind: u8,
  pub timestamp_us: i64,
  pub keyframe: bool,
  pub composition_time: i32,
  pub payload: &'a [u8],
}

/// Split a frame. `None` for anything too short to hold a header, which is the
/// only shape the encoder can produce that is not a frame.
pub fn parse_frame(bytes: &[u8]) -> Option<Frame<'_>> {
  if bytes.len() < FRAME_HEADER_LEN {
    return None;
  }
  let kind = bytes[0];
  let timestamp_us = i64::from_be_bytes(bytes[1..9].try_into().ok()?);
  let keyframe = bytes[9] & 1 == 1;
  let composition_time = i16::from_be_bytes(bytes[10..12].try_into().ok()?) as i32;
  Some(Frame {
    kind,
    timestamp_us,
    keyframe,
    composition_time,
    payload: &bytes[FRAME_HEADER_LEN..],
  })
}

/// The publisher in flight, if any. One at a time: a second destination would
/// need a second encoder, and the program is one picture.
#[derive(Default)]
pub struct Streams {
  current: Mutex<Option<Publisher>>,
}

impl Streams {
  /// Stop whatever is running and take the slot. Returns the previous publisher
  /// so the caller can stop it outside the lock.
  fn replace(&self) -> Result<Option<Publisher>, String> {
    let mut slot = self
      .current
      .lock()
      .map_err(|_| "the stream lock was poisoned".to_string())?;
    Ok(slot.take())
  }
}

#[tauri::command]
pub fn stream_start(
  app: tauri::AppHandle,
  url: String,
  key: String,
  width: u32,
  height: u32,
  frame_rate: f64,
  audio_sample_rate: u32,
  audio_channels: u32,
) -> Result<(), String> {
  use tauri::Manager;
  let streams = app.state::<Streams>();

  // A bad key is refused here, synchronously, so the button that started the
  // stream is the thing that reports it.
  let destination = parse_url(&url, &key).map_err(|error| error.to_string())?;

  if let Some(mut previous) = streams.replace()? {
    previous.stop();
  }

  let publisher = start(
    &destination,
    StartOptions {
      width,
      height,
      frame_rate,
      audio_sample_rate,
      audio_channels,
    },
  )
  .map_err(|error| error.to_string())?;

  let mut slot = streams
    .current
    .lock()
    .map_err(|_| "the stream lock was poisoned".to_string())?;
  *slot = Some(publisher);
  Ok(())
}

#[tauri::command]
pub fn stream_frame(app: tauri::AppHandle, request: tauri::ipc::Request<'_>) -> Result<(), String> {
  use tauri::Manager;
  let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else {
    return Err("a frame must arrive as a binary body".into());
  };
  let frame = parse_frame(bytes).ok_or_else(|| "that frame was too short to read".to_string())?;

  let streams = app.state::<Streams>();
  let slot = streams
    .current
    .lock()
    .map_err(|_| "the stream lock was poisoned".to_string())?;
  // Between a stop and the encoder winding down, frames are still in flight.
  // Dropping them is right: there is nothing left to send them to.
  let Some(publisher) = slot.as_ref() else {
    return Ok(());
  };

  let chunk = match frame.kind {
    KIND_VIDEO_SEQUENCE => Chunk::VideoSequence(frame.payload.to_vec()),
    KIND_AUDIO_SEQUENCE => Chunk::AudioSequence(frame.payload.to_vec()),
    KIND_VIDEO => Chunk::Video {
      data: frame.payload.to_vec(),
      keyframe: frame.keyframe,
      composition_time: frame.composition_time,
      timestamp_us: frame.timestamp_us,
    },
    KIND_AUDIO => Chunk::Audio {
      data: frame.payload.to_vec(),
      timestamp_us: frame.timestamp_us,
    },
    other => return Err(format!("unknown frame kind {other}")),
  };

  if publisher.send(chunk) {
    Ok(())
  } else {
    Err("the stream has stopped".into())
  }
}

#[tauri::command]
pub fn stream_stop(app: tauri::AppHandle) -> Result<(), String> {
  use tauri::Manager;
  let streams = app.state::<Streams>();
  let previous = streams.replace()?;
  if let Some(mut publisher) = previous {
    // Joins the publisher thread, so the platform has been told the stream is
    // over before this returns.
    publisher.stop();
  }
  Ok(())
}

/// `None` while the stream is healthy, otherwise the reason it ended. The UI
/// polls this rather than the Rust side pushing events, because a stream that
/// fails while nobody is looking is only ever noticed by looking.
#[tauri::command]
pub fn stream_failure(app: tauri::AppHandle) -> Result<Option<String>, String> {
  use tauri::Manager;
  let streams = app.state::<Streams>();
  let slot = streams
    .current
    .lock()
    .map_err(|_| "the stream lock was poisoned".to_string())?;
  Ok(slot
    .as_ref()
    .and_then(|publisher| publisher.status().failure().map(str::to_string)))
}

#[cfg(test)]
mod tests {
  use super::*;

  fn frame(kind: u8, timestamp_us: i64, keyframe: bool, composition_time: i32, payload: &[u8]) -> Vec<u8> {
    let mut bytes = vec![kind];
    bytes.extend_from_slice(&timestamp_us.to_be_bytes());
    bytes.push(u8::from(keyframe));
    bytes.extend_from_slice(&(composition_time as i16).to_be_bytes());
    bytes.extend_from_slice(payload);
    bytes
  }

  #[test]
  fn a_video_frame_round_trips() {
    let bytes = frame(KIND_VIDEO, 1_234_567, true, 40, &[9, 8, 7]);
    let parsed = parse_frame(&bytes).unwrap();
    assert_eq!(parsed.kind, KIND_VIDEO);
    assert_eq!(parsed.timestamp_us, 1_234_567);
    assert!(parsed.keyframe);
    assert_eq!(parsed.composition_time, 40);
    assert_eq!(parsed.payload, &[9, 8, 7]);
  }

  #[test]
  fn a_negative_composition_offset_survives_the_round_trip() {
    // B-frames put presentation after decode, but a negative offset is legal
    // and an encoder is free to emit one.
    let bytes = frame(KIND_VIDEO, 0, false, -30, &[1]);
    assert_eq!(parse_frame(&bytes).unwrap().composition_time, -30);
  }

  #[test]
  fn an_empty_payload_is_a_frame_not_an_error() {
    let bytes = frame(KIND_AUDIO_SEQUENCE, 0, false, 0, &[]);
    let parsed = parse_frame(&bytes).unwrap();
    assert_eq!(parsed.kind, KIND_AUDIO_SEQUENCE);
    assert_eq!(parsed.payload, &[] as &[u8]);
  }

  #[test]
  fn a_short_frame_is_rejected_rather_than_read_past_its_end() {
    assert!(parse_frame(&[]).is_none());
    assert!(parse_frame(&[0; FRAME_HEADER_LEN - 1]).is_none());
    // Exactly a header, with nothing behind it, is a frame with no payload.
    assert!(parse_frame(&[0; FRAME_HEADER_LEN]).is_some());
  }

  #[test]
  fn the_non_keyframe_flag_is_read_from_the_low_bit_only() {
    let mut bytes = frame(KIND_VIDEO, 0, false, 0, &[]);
    bytes[9] = 0xfe;
    assert!(!parse_frame(&bytes).unwrap().keyframe);
    bytes[9] = 0xff;
    assert!(parse_frame(&bytes).unwrap().keyframe);
  }
}
