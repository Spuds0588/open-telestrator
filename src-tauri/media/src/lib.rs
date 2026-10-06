//! RTMP publishing for the desktop build, with no third-party crates.
//!
//! The pieces, top to bottom:
//!
//! - [`url`] — where the publish goes, from an ingest address and a key.
//! - [`amf0`] — AMF0, only the handful of types RTMP commands use.
//! - [`flv`] — FLV tag bodies: H.264 and AAC, plus the metadata tag.
//! - [`chunk`] — RTMP's chunk framing, both directions.
//! - [`timing`] — putting the encoder's clock on the wire's clock.
//! - [`session`] — one connection: handshake, commands, and the tag pump.
//! - [`publisher`] — the handle the app holds, and its status.
//!
//! A webview cannot open an RTMP connection, so this is the half of stream-out
//! that has to be native. It deliberately does no encoding and no capture:
//! encoded frames arrive from the webview, which is what keeps the boundary
//! cheap and this crate small.

pub mod amf0;
pub mod chunk;
pub mod flv;
pub mod publisher;
pub mod session;
pub mod timing;
pub mod url;

pub use publisher::{start, Chunk, PublishError, Publisher, StartOptions, Status};
pub use url::{parse as parse_url, RtmpUrl, UrlError};
