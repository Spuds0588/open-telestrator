//! Putting the encoder's clock on the wire's clock.
//!
//! An encoder reports microseconds from a clock that started whenever it did,
//! and RTMP wants milliseconds counting from the start of the publish. Two
//! things therefore have to happen, and both are easy to get subtly wrong:
//!
//! 1. The first frame becomes zero, so a platform does not see a stream that
//!    appears to have been running for as long as the computer has been on.
//! 2. Time never goes backwards. Switching the program from one source to
//!    another — the whole point of a telestrator — can hand us timestamps from a
//!    different origin, and a player handed a timestamp earlier than the last one
//!    either stalls or jumps.
//!
//! Audio and video are tracked separately. They share a clock, but clamping them
//! against each other would let a slightly early audio frame drag the video
//! timeline backwards, so each track only has to stay monotonic against itself.

/// Which timeline a timestamp belongs to. The two are independent.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Track {
  Video,
  Audio,
}

/// Maps encoder microseconds onto the publish's millisecond timeline.
#[derive(Debug)]
pub struct Rebaser {
  base_us: Option<i64>,
  last_ms: [u32; 2],
}

impl Default for Rebaser {
  fn default() -> Self {
    Self::new()
  }
}

impl Rebaser {
  pub fn new() -> Self {
    Rebaser {
      base_us: None,
      last_ms: [0, 0],
    }
  }

  /// Milliseconds since the first chunk of either kind, never less than the
  /// last value this track was given.
  pub fn map(&mut self, track: Track, timestamp_us: i64) -> u32 {
    let base = *self.base_us.get_or_insert(timestamp_us);
    let index = match track {
      Track::Video => 0,
      Track::Audio => 1,
    };
    let elapsed = timestamp_us.saturating_sub(base);
    // A negative or absurd value still has to become a legal 24-bit-ish
    // timestamp, so it is clamped at both ends rather than wrapping.
    let ms = (elapsed / 1000).clamp(0, i64::from(u32::MAX)) as u32;
    let previous = self.last_ms[index];
    let ms = if ms < previous { previous } else { ms };
    self.last_ms[index] = ms;
    ms
  }

  /// The value the last chunk of a track mapped to, for reporting.
  pub fn last(&self, track: Track) -> u32 {
    match track {
      Track::Video => self.last_ms[0],
      Track::Audio => self.last_ms[1],
    }
  }
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn the_first_frame_becomes_zero() {
    let mut rebaser = Rebaser::new();
    assert_eq!(rebaser.map(Track::Video, 1_234_567_890), 0);
    assert_eq!(rebaser.map(Track::Video, 1_234_600_890), 33);
  }

  #[test]
  fn later_frames_are_relative_to_the_first_of_either_kind() {
    let mut rebaser = Rebaser::new();
    // Audio happens to arrive first and sets the origin for both tracks.
    assert_eq!(rebaser.map(Track::Audio, 1_000_000), 0);
    assert_eq!(rebaser.map(Track::Video, 1_020_000), 20);
    assert_eq!(rebaser.map(Track::Video, 1_040_000), 40);
  }

  #[test]
  fn a_timestamp_that_goes_backwards_is_pinned_not_wrapped() {
    let mut rebaser = Rebaser::new();
    rebaser.map(Track::Video, 0);
    assert_eq!(rebaser.map(Track::Video, 100_000), 100);
    // A new source with a younger clock: the wire must not rewind.
    assert_eq!(rebaser.map(Track::Video, 5_000), 100);
    // And normal progress continues from there.
    assert_eq!(rebaser.map(Track::Video, 130_000), 130);
  }

  #[test]
  fn the_tracks_do_not_clamp_each_other() {
    let mut rebaser = Rebaser::new();
    rebaser.map(Track::Video, 0);
    // Audio runs ahead of video, as it often does.
    assert_eq!(rebaser.map(Track::Audio, 50_000), 50);
    // Video's own timeline is unaffected by that.
    assert_eq!(rebaser.map(Track::Video, 10_000), 10);
    assert_eq!(rebaser.map(Track::Audio, 60_000), 60);
  }

  #[test]
  fn a_negative_timestamp_becomes_zero() {
    let mut rebaser = Rebaser::new();
    rebaser.map(Track::Video, 1_000_000);
    assert_eq!(rebaser.map(Track::Video, -500_000), 0);
  }

  #[test]
  fn last_reports_each_track_separately() {
    let mut rebaser = Rebaser::new();
    rebaser.map(Track::Video, 0);
    rebaser.map(Track::Audio, 0);
    rebaser.map(Track::Video, 1_000);
    assert_eq!(rebaser.last(Track::Video), 1);
    assert_eq!(rebaser.last(Track::Audio), 0);
  }

  #[test]
  fn a_timestamp_past_the_wire_range_is_clamped_rather_than_wrapped() {
    let mut rebaser = Rebaser::new();
    rebaser.map(Track::Video, 0);
    assert_eq!(rebaser.map(Track::Video, i64::MAX), u32::MAX);
  }
}
