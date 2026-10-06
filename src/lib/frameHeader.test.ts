import { describe, expect, it } from 'vitest'
import { FRAME_HEADER_LEN, FRAME_KIND, encodeFrame } from './frameHeader'

/** The layout the Rust reader in src-tauri/src/stream.rs parses. */
describe('encodeFrame', () => {
  it('writes the header at the offsets Rust reads', () => {
    const frame = encodeFrame({
      kind: FRAME_KIND.video,
      timestampUs: 1_234_567,
      keyframe: true,
      compositionTime: 0,
      payload: new Uint8Array([9, 8, 7]),
    })
    expect(frame.length).toBe(FRAME_HEADER_LEN + 3)
    expect(frame[0]).toBe(FRAME_KIND.video)
    expect(new DataView(frame.buffer).getBigInt64(1)).toBe(1_234_567n)
    expect(frame[9]).toBe(1)
    expect(new DataView(frame.buffer).getInt16(10)).toBe(0)
    expect([...frame.slice(FRAME_HEADER_LEN)]).toEqual([9, 8, 7])
  })

  it('carries a timestamp past what a 32-bit view could hold', () => {
    // A runtime past about 71 minutes overflows micros in 32 bits; a long
    // broadcast must not wrap.
    const timestampUs = 5_000_000_000
    const frame = encodeFrame({
      kind: FRAME_KIND.video,
      timestampUs,
      keyframe: false,
      compositionTime: 0,
      payload: new Uint8Array(),
    })
    expect(new DataView(frame.buffer).getBigInt64(1)).toBe(BigInt(timestampUs))
  })

  it('leaves the keyframe bit clear when the frame is not one', () => {
    const frame = encodeFrame({
      kind: FRAME_KIND.video,
      timestampUs: 0,
      keyframe: false,
      compositionTime: 0,
      payload: new Uint8Array(),
    })
    expect(frame[9]).toBe(0)
  })

  it('keeps a negative composition offset signed', () => {
    const frame = encodeFrame({
      kind: FRAME_KIND.video,
      timestampUs: 0,
      keyframe: false,
      compositionTime: -30,
      payload: new Uint8Array(),
    })
    expect(new DataView(frame.buffer).getInt16(10)).toBe(-30)
  })

  it('sends a sequence header with an empty payload as a plain header', () => {
    const frame = encodeFrame({
      kind: FRAME_KIND.audioSequence,
      timestampUs: 0,
      keyframe: false,
      compositionTime: 0,
      payload: new Uint8Array(),
    })
    expect(frame.length).toBe(FRAME_HEADER_LEN)
    expect(frame[0]).toBe(FRAME_KIND.audioSequence)
  })

  it('gives every kind a distinct number', () => {
    const kinds = Object.values(FRAME_KIND)
    expect(new Set(kinds).size).toBe(kinds.length)
    // The order matters: Rust matches on these values.
    expect(FRAME_KIND).toEqual({ videoSequence: 0, audioSequence: 1, video: 2, audio: 3 })
  })
})
