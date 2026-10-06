//! Where an RTMP publish goes: scheme, host, port, application and stream name.
//!
//! Platforms hand this over in two halves — an ingest address like
//! `rtmps://a.rtmp.youtube.com/live2` and a stream key — but the wire protocol
//! wants one address plus a stream name, and people paste it in every
//! combination: the key in the URL, the key in its own field, a full address
//! with the application name left off. All of those are accepted here, because
//! the alternative is a user staring at "invalid URL" with a correct one in
//! front of them.

use std::fmt;

/// The pieces an RTMP publish needs.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RtmpUrl {
  /// `rtmps://`, which means the socket is wrapped in TLS.
  pub secure: bool,
  pub host: String,
  pub port: u16,
  /// The application name, the first path segment. `live2` for YouTube.
  pub app: String,
  /// The stream name: the key.
  pub stream_name: String,
}

impl RtmpUrl {
  /// The address the server is told about in `connect`. It must name the same
  /// application we later publish to, including the port we actually dialled.
  pub fn tc_url(&self) -> String {
    let scheme = if self.secure { "rtmps" } else { "rtmp" };
    format!("{scheme}://{}:{}/{}", self.host, self.port, self.app)
  }
}

impl fmt::Display for RtmpUrl {
  /// Rendered without the stream name: this is what gets logged or shown when a
  /// connection fails, and a stream key is a credential.
  fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
    let scheme = if self.secure { "rtmps" } else { "rtmp" };
    write!(f, "{scheme}://{}:{}/{}", self.host, self.port, self.app)
  }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum UrlError {
  /// No scheme, or one that is not RTMP.
  Scheme,
  /// No host to dial.
  Host,
  /// The address names no application, so there is nowhere to publish.
  App,
  /// The address and the key field are both empty of a stream name.
  StreamName(StreamNameError),
}

/// Why a stream name is missing, so the UI can ask the right question.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StreamNameError {
  /// An application but no key, and no key typed alongside it.
  Missing,
}

impl fmt::Display for UrlError {
  fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
    match self {
      UrlError::Scheme => write!(
        f,
        "The address must start with rtmp:// or rtmps:// — rtmps is the encrypted one."
      ),
      UrlError::Host => write!(f, "The address needs a host, like a.rtmp.youtube.com."),
      UrlError::App => write!(
        f,
        "The address needs an application name, like live2 in rtmps://a.rtmp.youtube.com/live2."
      ),
      UrlError::StreamName(StreamNameError::Missing) => {
        write!(f, "A stream key is needed — the platform shows it next to its ingest address.")
      }
    }
  }
}

impl std::error::Error for UrlError {}

/// Split an ingest address and an optional key into the pieces RTMP wants.
///
/// `key` wins when it is present, because a key typed into the dedicated field
/// is almost always the one the user meant, and a stale key left in the URL is
/// exactly the kind of thing that produces a confusing "unauthorized".
pub fn parse(address: &str, key: &str) -> Result<RtmpUrl, UrlError> {
  let address = address.trim();
  let key = key.trim();

  let (scheme, rest) = match address.split_once("://") {
    Some((scheme, rest)) => (scheme.to_ascii_lowercase(), rest),
    None => return Err(UrlError::Scheme),
  };
  let secure = match scheme.as_str() {
    "rtmp" => false,
    // Both `rtmps` and the occasional `rtmp+tls` reach us from different
    // platforms' copy buttons.
    "rtmps" | "rtmp+tls" => true,
    _ => return Err(UrlError::Scheme),
  };

  // Strip any query or fragment before splitting the path: some platforms append
  // `?backup=1` to a backup ingest address.
  let rest = rest.split(['?', '#']).next().unwrap_or("");
  let (authority, path) = match rest.split_once('/') {
    Some((authority, path)) => (authority, path),
    None => (rest, ""),
  };

  // Userinfo is not meaningful for an ingest address and is dropped.
  let authority = authority.rsplit('@').next().unwrap_or(authority);

  let (host, port) = split_authority(authority, secure)?;
  if host.is_empty() {
    return Err(UrlError::Host);
  }

  let segments: Vec<&str> = path.split('/').filter(|segment| !segment.is_empty()).collect();
  if segments.is_empty() {
    return Err(UrlError::App);
  }
  let app = segments[0].to_string();

  // A key typed into its own field wins; otherwise the name is whatever the
  // path carries beyond the application.
  let stream_name = if !key.is_empty() {
    key.to_string()
  } else if segments.len() > 1 {
    segments[1..].join("/")
  } else {
    return Err(UrlError::StreamName(StreamNameError::Missing));
  };

  Ok(RtmpUrl {
    secure,
    host,
    port,
    app,
    stream_name,
  })
}

/// The default port RTMP dialects listen on: 1935 plain, 443 for TLS. YouTube's
/// `rtmps://` ingest is on 443, so a missing port there must not guess 1935.
fn split_authority(authority: &str, secure: bool) -> Result<(String, u16), UrlError> {
  // Bracketed IPv6 literals are not something a platform ingest address uses,
  // but a self-hosted one might.
  if let Some(rest) = authority.strip_prefix('[') {
    let (host, tail) = match rest.split_once(']') {
      Some(split) => split,
      None => return Err(UrlError::Host),
    };
    let port = match tail.strip_prefix(':') {
      Some(port) => parse_port(port)?,
      None => default_port(secure),
    };
    return Ok((host.to_string(), port));
  }

  match authority.rsplit_once(':') {
    Some((host, port)) if !port.is_empty() && port.bytes().all(|byte| byte.is_ascii_digit()) => {
      Ok((host.to_string(), parse_port(port)?))
    }
    _ => Ok((authority.to_string(), default_port(secure))),
  }
}

fn parse_port(port: &str) -> Result<u16, UrlError> {
  port.parse::<u16>().map_err(|_| UrlError::Host)
}

fn default_port(secure: bool) -> u16 {
  if secure {
    443
  } else {
    1935
  }
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn youtube_ingest_and_key_in_two_fields() {
    let url = parse("rtmps://a.rtmp.youtube.com/live2", "abcd-efgh-ijkl").unwrap();
    assert_eq!(
      url,
      RtmpUrl {
        secure: true,
        host: "a.rtmp.youtube.com".into(),
        port: 443,
        app: "live2".into(),
        stream_name: "abcd-efgh-ijkl".into(),
      }
    );
    assert_eq!(url.tc_url(), "rtmps://a.rtmp.youtube.com:443/live2");
  }

  #[test]
  fn the_plain_scheme_defaults_to_1935_not_443() {
    let url = parse("rtmp://a.rtmp.youtube.com/live2", "key").unwrap();
    assert!(!url.secure);
    assert_eq!(url.port, 1935);
    assert_eq!(url.tc_url(), "rtmp://a.rtmp.youtube.com:1935/live2");
  }

  #[test]
  fn a_key_in_the_path_is_taken_as_the_stream_name() {
    let url = parse("rtmp://localhost/live/my-key", "").unwrap();
    assert_eq!(url.app, "live");
    assert_eq!(url.stream_name, "my-key");

    // What a platform's "full address" field tends to contain.
    let url = parse("rtmps://a.rtmp.youtube.com/live2/abcd-efgh", "").unwrap();
    assert_eq!(url.app, "live2");
    assert_eq!(url.stream_name, "abcd-efgh");
  }

  #[test]
  fn a_typed_key_overrides_one_left_in_the_address() {
    let url = parse("rtmp://localhost/live/stale", "fresh").unwrap();
    assert_eq!(url.stream_name, "fresh");
  }

  #[test]
  fn a_key_containing_slashes_survives_the_path_split() {
    // Some keys are long opaque strings; a slash in one must not be treated as
    // another path segment boundary when it was typed into the key field.
    let url = parse("rtmp://ingest.example.com/app", "a/b/c").unwrap();
    assert_eq!(url.stream_name, "a/b/c");
    assert_eq!(url.app, "app");
  }

  #[test]
  fn an_explicit_port_is_kept() {
    let url = parse("rtmp://10.0.0.5:1936/live", "key").unwrap();
    assert_eq!(url.host, "10.0.0.5");
    assert_eq!(url.port, 1936);
  }

  #[test]
  fn surrounding_whitespace_and_query_strings_are_tolerated() {
    let url = parse("  rtmps://a.rtmp.youtube.com/live2?backup=1  ", " key ").unwrap();
    assert_eq!(url.host, "a.rtmp.youtube.com");
    assert_eq!(url.stream_name, "key");
  }

  #[test]
  fn userinfo_is_dropped_rather_than_mistaken_for_a_host() {
    let url = parse("rtmp://user:pass@ingest.example.com/live", "key").unwrap();
    assert_eq!(url.host, "ingest.example.com");
  }

  #[test]
  fn a_wrong_scheme_is_named_as_the_problem() {
    assert_eq!(parse("https://a.rtmp.youtube.com/live2", "key"), Err(UrlError::Scheme));
    assert_eq!(parse("a.rtmp.youtube.com/live2", "key"), Err(UrlError::Scheme));
    assert_eq!(parse("", "key"), Err(UrlError::Scheme));
  }

  #[test]
  fn a_missing_application_or_stream_name_is_rejected() {
    assert_eq!(parse("rtmp://host", "key"), Err(UrlError::App));
    assert_eq!(parse("rtmp://host/", "key"), Err(UrlError::App));
    assert_eq!(parse("rtmp://host/live", ""), Err(UrlError::StreamName(StreamNameError::Missing)));
  }

  #[test]
  fn a_host_is_required() {
    assert_eq!(parse("rtmp://", "key"), Err(UrlError::Host));
    assert_eq!(parse("rtmp://:1935/live", "key"), Err(UrlError::Host));
  }

  #[test]
  fn an_ipv6_host_is_understood() {
    let url = parse("rtmp://[::1]:1935/live", "key").unwrap();
    assert_eq!(url.host, "::1");
    assert_eq!(url.port, 1935);
    // And without a port, the scheme's default.
    let url = parse("rtmps://[::1]/live", "key").unwrap();
    assert_eq!(url.port, 443);
  }

  #[test]
  fn display_never_leaks_the_stream_key() {
    let url = parse("rtmps://a.rtmp.youtube.com/live2", "super-secret").unwrap();
    let shown = url.to_string();
    assert!(!shown.contains("super-secret"));
    assert_eq!(shown, "rtmps://a.rtmp.youtube.com:443/live2");
  }

  #[test]
  fn a_non_numeric_port_falls_back_to_the_authority_being_a_host() {
    // `host:abc` is not a port, so the whole thing is the host — matching what
    // a user typing a stray colon meant far better than an error would.
    let url = parse("rtmp://host:abc/live", "key").unwrap();
    assert_eq!(url.host, "host:abc");
    assert_eq!(url.port, 1935);
  }
}
