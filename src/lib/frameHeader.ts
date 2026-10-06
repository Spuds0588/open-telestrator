/**
 * One encoded frame, packed for the desktop shell.
 *
 * The webview encodes; Rust pushes to RTMP. Between them travels this: a fixed
 * header and the encoder's own bytes — never pixels. That distinction is the
 * whole reason the boundary is cheap enough to be an ordinary IPC call, since
 * an encoded broadcast is a few hundred kilobytes a second where raw frames
 * would be hundreds of megabytes.
 *
 * The layout is mirrored in `src-tauri/src/stream.rs`, and both sides pin it
 * with tests. Change one and the other fails, which is the point: a byte of
 * drift here is a stream that connects and then shows nothing.
 *
 * ```text
 * 0        kind
 * 1  .. 9  timestamp, microseconds since the program started, i64 big-endian
 * 9        flags — bit 0 means "this frame is a keyframe"
 * 10 .. 12 composition time, milliseconds, i16 big-endian
 * 12 ..    the encoder's payload
 * ```
 */

/** Bytes before the payload. */
export const FRAME_HEADER_LEN = 12

/**
 * What a frame is. The sequence headers come first and describe the stream; the
 * frames follow, and a platform that receives a frame before its sequence
 * header has nothing to decode it with.
 */
export const FRAME_KIND = {
  videoSequence: 0,
  audioSequence: 1,
  video: 2,
  audio: 3,
} as const

export type FrameKind = (typeof FRAME_KIND)[keyof typeof FRAME_KIND]

export interface FrameInput {
  kind: FrameKind
  /** Microseconds from the encoder's clock; zeroed on the wire by Rust. */
  timestampUs: number
  /** Only meaningful for a video frame; ignored for the sequence headers. */
  keyframe: boolean
  /** Presentation time minus decode time. Negative with B-frames. */
  compositionTime: number
  payload: Uint8Array
}

/** Pack a frame into the body the shell reads. */
export function encodeFrame({
  kind,
  timestampUs,
  keyframe,
  compositionTime,
  payload,
}: FrameInput): Uint8Array {
  const frame = new Uint8Array(FRAME_HEADER_LEN + payload.length)
  const view = new DataView(frame.buffer)
  view.setUint8(0, kind)
  // Big-endian and signed, and written as a BigInt because a microsecond clock
  // is past what a 32-bit view can hold after a few hours.
  view.setBigInt64(1, BigInt(Math.trunc(timestampUs)))
  view.setUint8(9, keyframe ? 1 : 0)
  view.setInt16(10, compositionTime)
  frame.set(payload, FRAME_HEADER_LEN)
  return frame
}
