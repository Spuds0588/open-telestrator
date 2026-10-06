//! FLV, the container RTMP carries.
//!
//! RTMP does not send a file: it sends a stream of FLV tag *bodies*, each
//! framed by the RTMP chunk layer instead of by a file's tag header. So this
//! module is a set of pure byte builders rather than a writer over a file, and
//! the tag type constants double as the RTMP message type ids they are sent
//! under. Everything here is a function from a chunk to bytes, which is what
//! makes the container testable against pinned vectors.
//!
//! Only the two codecs a browser can hand us are represented: H.264 video and
//! AAC audio. Both need a sequence header sent before any frame — the decoder
//! configuration a player cannot guess — and both then carry frames as
//! length-prefixed NAL units (video) or raw access units (audio).

/// FLV tag types, which are also the RTMP message type ids they travel under.
pub const TAG_AUDIO: u8 = 8;
pub const TAG_VIDEO: u8 = 9;
pub const TAG_SCRIPT: u8 = 18;

/// Codec ids, in the high nibble of a video tag's first byte.
const CODEC_AVC: u8 = 7;
/// The low nibble of a video tag's first byte.
const FRAME_KEY: u8 = 1;
const FRAME_INTER: u8 = 2;
/// The first byte of every AAC tag: sound format 10 in the high nibble, with
/// 44 kHz, 16-bit and stereo in the rest. AAC is always the same shape, so this
/// is written out rather than assembled.
const AAC_HEADER: u8 = 0xaf;


/// The AVCDecoderConfigurationRecord: profile, level, and the SPS and PPS the
/// decoder needs before the first frame. `description` is the encoder's own
/// `decoderConfig.description` — WebCodecs already produces exactly this
/// structure, so it is passed through rather than rebuilt.
pub fn avc_sequence_header(description: &[u8]) -> Vec<u8> {
  let mut data = vec![0x17, 0x00, 0x00, 0x00, 0x00];
  data.extend_from_slice(description);
  data
}

/// One AVCC video frame: a composition-time offset followed by 4-byte-length-
/// prefixed NAL units.
pub fn avc_frame(data: &[u8], keyframe: bool, composition_time_ms: i32) -> Vec<u8> {
  let mut out = Vec::with_capacity(data.len() + 5);
  out.push(if keyframe {
    (FRAME_KEY << 4) | CODEC_AVC
  } else {
    (FRAME_INTER << 4) | CODEC_AVC
  });
  out.push(0x01); // AVCPacketType::NALU
  // A signed 24-bit big-endian offset.
  let offset = composition_time_ms.to_be_bytes();
  out.extend_from_slice(&offset[1..]);
  out.extend_from_slice(data);
  out
}

/// The AudioSpecificConfig: the decoder configuration for AAC. `description` is
/// the encoder's own, passed through for the same reason as the video one.
pub fn aac_sequence_header(description: &[u8]) -> Vec<u8> {
  let mut data = vec![AAC_HEADER, 0x00];
  data.extend_from_slice(description);
  data
}

/// One AAC access unit. `data` is raw AAC, which is what an `AudioEncoder`
/// chunk holds and what FLV carries.
pub fn aac_frame(data: &[u8]) -> Vec<u8> {
  let mut out = Vec::with_capacity(data.len() + 2);
  out.extend_from_slice(&[AAC_HEADER, 0x01]);
  out.extend_from_slice(data);
  out
}

/// The `onMetaData` tag: resolution, frame rate and the audio shape, which is
/// what a platform reads to decide the stream is healthy and what a recorder
/// needs to play the result back.
pub fn metadata_tag(
  width: u32,
  height: u32,
  frame_rate: f64,
  audio_sample_rate: u32,
  audio_channels: u32,
) -> Vec<u8> {
  use crate::amf0::{encode_to_vec, Value};

  let entries = vec![
    ("duration".to_string(), Value::Number(0.0)),
    ("width".to_string(), Value::Number(f64::from(width))),
    ("height".to_string(), Value::Number(f64::from(height))),
    ("videodatarate".to_string(), Value::Number(0.0)),
    ("framerate".to_string(), Value::Number(frame_rate)),
    ("videocodecid".to_string(), Value::Number(7.0)),
    ("audiodatarate".to_string(), Value::Number(0.0)),
    ("audiosamplerate".to_string(), Value::Number(f64::from(audio_sample_rate))),
    ("audiosamplesize".to_string(), Value::Number(16.0)),
    ("stereo".to_string(), Value::Boolean(audio_channels > 1)),
    ("audiocodecid".to_string(), Value::Number(10.0)),
    ("encoder".to_string(), Value::String("Open Telestrator".to_string())),
  ];

  let mut data = Vec::new();
  data.push(0x02); // AMF0 string
  data.extend_from_slice(&(("onMetaData".len()) as u16).to_be_bytes());
  data.extend_from_slice(b"onMetaData");
  data.extend_from_slice(&encode_to_vec(&Value::EcmaArray(entries)));
  data
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn video_frame_carries_the_composition_offset() {
    let key = avc_frame(&[1, 2], true, 0);
    assert_eq!(key[0], 0x17);
    assert_eq!(key[1], 0x01);
    assert_eq!(&key[2..5], &[0, 0, 0]);
    assert_eq!(&key[5..], &[1, 2]);

    let inter = avc_frame(&[3], false, 40);
    assert_eq!(inter[0], 0x27);
    assert_eq!(&inter[2..5], &[0, 0, 40]);
  }

  #[test]
  fn sequence_headers_use_packet_type_zero_and_pass_the_description_through() {
    let avc = avc_sequence_header(&[0x01, 0x42, 0xc0, 0x1e]);
    assert_eq!(&avc[..5], &[0x17, 0x00, 0, 0, 0]);
    assert_eq!(&avc[5..], &[0x01, 0x42, 0xc0, 0x1e]);

    let aac = aac_sequence_header(&[0x11, 0x90]);
    assert_eq!(aac, vec![0xaf, 0x00, 0x11, 0x90]);
  }

  #[test]
  fn aac_frames_are_raw_access_units_behind_the_format_byte() {
    assert_eq!(aac_frame(&[7, 8, 9]), vec![0xaf, 0x01, 7, 8, 9]);
  }

  #[test]
  fn metadata_tag_is_amf0_and_carries_the_shape() {
    let bytes = metadata_tag(1920, 1080, 30.0, 48000, 2);
    assert_eq!(bytes[0], 0x02);
    let name_len = u16::from_be_bytes(bytes[1..3].try_into().unwrap());
    assert_eq!(name_len, 10);
    assert_eq!(&bytes[3..13], b"onMetaData");
    assert_eq!(bytes[13], 0x08);
    let (value, rest) = crate::amf0::decode(&bytes[13..]).unwrap();
    assert_eq!(rest, &[]);
    assert_eq!(value.get("width"), Some(&crate::amf0::Value::Number(1920.0)));
    assert_eq!(value.get("videocodecid"), Some(&crate::amf0::Value::Number(7.0)));
    assert_eq!(value.get("audiocodecid"), Some(&crate::amf0::Value::Number(10.0)));
    assert_eq!(value.get("stereo"), Some(&crate::amf0::Value::Boolean(true)));
    assert_eq!(value.get("framerate"), Some(&crate::amf0::Value::Number(30.0)));
  }
}
