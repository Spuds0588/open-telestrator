//! AMF0, only as much of it as RTMP commands and FLV `onMetaData` need.
//!
//! RTMP speaks AMF0 on its command and data messages: `connect` sends an
//! object, `_result` and `onStatus` come back as one, and the FLV metadata tag
//! is an ECMA array. Everything else in the spec (references, dates, XML,
//! typed objects, long strings) is deliberately absent — a publisher never
//! sends or reads it, and decoding a message we do not understand is not worth
//! a byte of surface area.

/// A decoded AMF0 value. Only the shapes counted on above.
#[derive(Debug, Clone, PartialEq)]
pub enum Value {
  Number(f64),
  Boolean(bool),
  String(String),
  Object(Vec<(String, Value)>),
  Null,
  /// An ECMA array (`onMetaData` is one). Decoded like an object; the encoder
  /// keeps the distinct marker so a re-encoded value is still an array.
  EcmaArray(Vec<(String, Value)>),
}

impl Value {
  /// The string value, or `None` for any other type. Command replies put the
  /// interesting word — `NetStream.Publish.Start`, `status` — in one of these.
  pub fn as_str(&self) -> Option<&str> {
    match self {
      Value::String(text) => Some(text),
      _ => None,
    }
  }

  /// Look a key up in an object or ECMA array.
  pub fn get(&self, key: &str) -> Option<&Value> {
    let entries = match self {
      Value::Object(entries) | Value::EcmaArray(entries) => entries,
      _ => return None,
    };
    entries.iter().find(|(name, _)| name == key).map(|(_, value)| value)
  }
}

/// Encode a value, appending to `out`.
pub fn encode(value: &Value, out: &mut Vec<u8>) {
  match value {
    Value::Number(number) => {
      out.push(0x00);
      out.extend_from_slice(&number.to_be_bytes());
    }
    Value::Boolean(flag) => {
      out.push(0x01);
      out.push(u8::from(*flag));
    }
    Value::String(text) => {
      out.push(0x02);
      encode_string(text, out);
    }
    Value::Null => out.push(0x05),
    Value::Object(entries) => {
      out.push(0x03);
      encode_entries(entries, out);
    }
    Value::EcmaArray(entries) => {
      out.push(0x08);
      // A count is part of the wire format. Servers ignore it, but writing the
      // real length keeps the message honest.
      out.extend_from_slice(&(entries.len() as u32).to_be_bytes());
      encode_entries(entries, out);
    }
  }
}

/// Encode a value into a fresh buffer.
pub fn encode_to_vec(value: &Value) -> Vec<u8> {
  let mut out = Vec::new();
  encode(value, &mut out);
  out
}

fn encode_string(text: &str, out: &mut Vec<u8>) {
  let bytes = text.as_bytes();
  out.extend_from_slice(&(bytes.len() as u16).to_be_bytes());
  out.extend_from_slice(bytes);
}

fn encode_entries(entries: &[(String, Value)], out: &mut Vec<u8>) {
  for (name, value) in entries {
    encode_string(name, out);
    encode(value, out);
  }
  // The object end marker: an empty key followed by the object-end type.
  out.extend_from_slice(&[0x00, 0x00, 0x09]);
}

/// Read one value from the front of `input`, returning it and the rest.
///
/// Returns `None` for a marker this decoder does not implement, an empty
/// buffer, or a string whose length runs past the end. Callers treat that as
/// "this message is not for us" and skip it: an RTMP peer is free to send
/// types we never use, and a malformed reply must not be able to make the
/// publisher panic mid-broadcast.
pub fn decode(input: &[u8]) -> Option<(Value, &[u8])> {
  let (&marker, rest) = input.split_first()?;
  match marker {
    0x00 => {
      let (bytes, rest) = take(rest, 8)?;
      let number = f64::from_be_bytes(bytes.try_into().ok()?);
      Some((Value::Number(number), rest))
    }
    0x01 => {
      let (&flag, rest) = rest.split_first()?;
      Some((Value::Boolean(flag != 0), rest))
    }
    0x02 => {
      let (text, rest) = decode_string(rest)?;
      Some((Value::String(text), rest))
    }
    0x03 => decode_object(rest, false),
    0x05 | 0x06 => Some((Value::Null, rest)),
    0x08 => {
      let (_, rest) = take(rest, 4)?;
      decode_object(rest, true)
    }
    _ => None,
  }
}

fn decode_object(input: &[u8], ecma: bool) -> Option<(Value, &[u8])> {
  let mut entries = Vec::new();
  let mut rest = input;
  loop {
    let (name, after_name) = decode_string(rest)?;
    rest = after_name;
    // The end marker is an empty key with the object-end type behind it.
    if name.is_empty() {
      let (&end, after) = rest.split_first()?;
      if end != 0x09 {
        return None;
      }
      rest = after;
      break;
    }
    let (value, after_value) = decode(rest)?;
    rest = after_value;
    entries.push((name, value));
  }
  let value = if ecma {
    Value::EcmaArray(entries)
  } else {
    Value::Object(entries)
  };
  Some((value, rest))
}

fn decode_string(input: &[u8]) -> Option<(String, &[u8])> {
  let (length, rest) = take(input, 2)?;
  let length = u16::from_be_bytes(length.try_into().ok()?) as usize;
  let (bytes, rest) = take(rest, length)?;
  // Command names and status codes are ASCII; anything that is not is dropped
  // rather than fatal.
  Some((String::from_utf8_lossy(bytes).into_owned(), rest))
}

fn take(input: &[u8], count: usize) -> Option<(&[u8], &[u8])> {
  if input.len() < count {
    return None;
  }
  Some(input.split_at(count))
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn number_round_trips() {
    let bytes = encode_to_vec(&Value::Number(1.0));
    assert_eq!(bytes, vec![0x00, 0x3f, 0xf0, 0, 0, 0, 0, 0, 0]);
    let (value, rest) = decode(&bytes).unwrap();
    assert_eq!(value, Value::Number(1.0));
    assert!(rest.is_empty());
  }

  #[test]
  fn string_round_trips() {
    let bytes = encode_to_vec(&Value::String("live".into()));
    assert_eq!(bytes, vec![0x02, 0x00, 0x04, b'l', b'i', b'v', b'e']);
    let (value, _) = decode(&bytes).unwrap();
    assert_eq!(value, Value::String("live".into()));
  }

  #[test]
  fn connect_command_matches_the_reference_bytes() {
    // The shape every publisher sends: command name, transaction id, and the
    // command object. Pinned because a byte of drift here breaks the handshake
    // with every server at once.
    let bytes = encode_to_vec(&Value::String("connect".into()));
    assert_eq!(&bytes[..10], b"\x02\x00\x07connect");
    let bytes = encode_to_vec(&Value::Object(vec![(
      "app".into(),
      Value::String("live".into()),
    )]));
    assert_eq!(
      &bytes[..],
      b"\x03\x00\x03app\x02\x00\x04live\x00\x00\x09"
    );
  }

  #[test]
  fn object_end_marker_closes_an_empty_object() {
    assert_eq!(encode_to_vec(&Value::Object(vec![])), vec![0x03, 0x00, 0x00, 0x09]);
  }

  #[test]
  fn ecma_array_is_distinguishable_from_an_object() {
    let value = Value::EcmaArray(vec![("width".into(), Value::Number(1920.0))]);
    let bytes = encode_to_vec(&value);
    assert_eq!(bytes[0], 0x08);
    // The array carries a count the plain object does not.
    assert_eq!(&bytes[1..5], &1u32.to_be_bytes());
    let (decoded, _) = decode(&bytes).unwrap();
    assert_eq!(decoded, value);
  }

  #[test]
  fn nested_objects_round_trip() {
    let value = Value::Object(vec![
      ("app".into(), Value::String("live".into())),
      (
        "info".into(),
        Value::Object(vec![
          ("level".into(), Value::String("status".into())),
          ("code".into(), Value::String("NetStream.Publish.Start".into())),
          ("flag".into(), Value::Boolean(true)),
        ]),
      ),
      ("nothing".into(), Value::Null),
    ]);
    let bytes = encode_to_vec(&value);
    let (decoded, rest) = decode(&bytes).unwrap();
    assert_eq!(decoded, value);
    assert!(rest.is_empty());
    assert_eq!(
      decoded.get("info").and_then(|info| info.get("code")).and_then(Value::as_str),
      Some("NetStream.Publish.Start")
    );
  }

  #[test]
  fn decode_returns_the_remainder_for_a_stream_of_values() {
    let mut bytes = encode_to_vec(&Value::Number(1.0));
    bytes.extend(encode_to_vec(&Value::String("onStatus".into())));
    let (first, rest) = decode(&bytes).unwrap();
    assert_eq!(first, Value::Number(1.0));
    let (second, rest) = decode(rest).unwrap();
    assert_eq!(second, Value::String("onStatus".into()));
    assert!(rest.is_empty());
  }

  #[test]
  fn unsupported_and_truncated_input_is_rejected_not_fatal() {
    // Unimplemented markers, a long string, a date.
    assert!(decode(&[0x0b, 0, 0, 0, 0]).is_none());
    assert!(decode(&[0x0c]).is_none());
    assert!(decode(&[]).is_none());
    // A string whose length runs off the end.
    assert!(decode(&[0x02, 0x00, 0x08, b'a']).is_none());
    // An object that never terminates.
    assert!(decode(&[0x03, 0x00, 0x03, b'a', b'b', b'c']).is_none());
  }

  #[test]
  fn get_reads_through_both_object_flavours() {
    let object = Value::Object(vec![("a".into(), Value::Number(1.0))]);
    let array = Value::EcmaArray(vec![("a".into(), Value::Number(1.0))]);
    assert_eq!(object.get("a"), Some(&Value::Number(1.0)));
    assert_eq!(array.get("a"), Some(&Value::Number(1.0)));
    assert_eq!(array.get("missing"), None);
    assert_eq!(Value::Null.get("a"), None);
  }
}
