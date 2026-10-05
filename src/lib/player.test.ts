import { describe, expect, it } from 'vitest'
import {
  PAUSE_BUFFER_LIMIT_MS,
  RECORDER_MIME_CANDIDATES,
  backlogFinished,
  bufferLimitReached,
  castState,
  clampVolume,
  formatClock,
  pickPipMode,
  pickRecorderMime,
  stepVolume,
  volumeLevel,
} from './player'

describe('volume', () => {
  it('clamps anything into 0–1', () => {
    expect(clampVolume(0.5)).toBe(0.5)
    expect(clampVolume(-2)).toBe(0)
    expect(clampVolume(7)).toBe(1)
    expect(clampVolume(Number.NaN)).toBe(0)
  })

  it('steps without leaving the range', () => {
    expect(stepVolume(0.5, 0.1)).toBeCloseTo(0.6)
    expect(stepVolume(0.95, 0.1)).toBe(1)
    expect(stepVolume(0.05, -0.1)).toBe(0)
    expect(stepVolume(0.5, 0)).toBeCloseTo(0.5)
  })

  it('picks the speaker icon the state calls for', () => {
    expect(volumeLevel(1, false)).toBe('high')
    expect(volumeLevel(0.8, false)).toBe('high')
    expect(volumeLevel(0.2, false)).toBe('low')
    expect(volumeLevel(1, true)).toBe('muted')
    expect(volumeLevel(0, false)).toBe('muted')
  })
})

describe('pickPipMode', () => {
  it('prefers document picture-in-picture, which keeps the controls', () => {
    expect(pickPipMode(true, true)).toBe('document')
    expect(pickPipMode(true, false)).toBe('document')
  })

  it('falls back to the video-only picture-in-picture', () => {
    expect(pickPipMode(false, true)).toBe('video')
  })

  it('offers nothing where the browser has neither', () => {
    expect(pickPipMode(false, false)).toBe('none')
  })
})

describe('castState', () => {
  it('is only offered where the browser implements the API', () => {
    expect(castState(false, null)).toBe('unsupported')
    expect(castState(false, 'connected')).toBe('unsupported')
  })

  it('follows the browser once it does', () => {
    expect(castState(true, 'disconnected')).toBe('available')
    expect(castState(true, null)).toBe('available')
    expect(castState(true, 'connecting')).toBe('connecting')
    expect(castState(true, 'connected')).toBe('connected')
  })
})

describe('pause buffer', () => {
  it('prefers webm and falls back to mp4', () => {
    expect(pickRecorderMime(() => true)).toBe(RECORDER_MIME_CANDIDATES[0])
    expect(pickRecorderMime((type) => type === 'video/webm')).toBe('video/webm')
    expect(pickRecorderMime((type) => type === 'video/mp4')).toBe('video/mp4')
  })

  it('gives up rather than recording something unplayable', () => {
    expect(pickRecorderMime(() => false)).toBeNull()
  })

  it('stops growing at the cap', () => {
    expect(bufferLimitReached(0)).toBe(false)
    expect(bufferLimitReached(PAUSE_BUFFER_LIMIT_MS - 1)).toBe(false)
    expect(bufferLimitReached(PAUSE_BUFFER_LIMIT_MS)).toBe(true)
    expect(bufferLimitReached(PAUSE_BUFFER_LIMIT_MS * 10)).toBe(true)
  })
})

describe('backlogFinished', () => {
  it('keeps playing until the recorded length is reached', () => {
    expect(backlogFinished(0, 10_000)).toBe(false)
    expect(backlogFinished(5_000, 10_000)).toBe(false)
    expect(backlogFinished(9_000, 10_000)).toBe(false)
  })

  it('finishes at the end, allowing for a small tail', () => {
    expect(backlogFinished(9_700, 10_000)).toBe(true)
    expect(backlogFinished(10_000, 10_000)).toBe(true)
    expect(backlogFinished(12_000, 10_000)).toBe(true)
  })

  it('never reports a finish when nothing was recorded', () => {
    expect(backlogFinished(5_000, 0)).toBe(false)
    expect(backlogFinished(5_000, -1)).toBe(false)
  })
})

describe('formatClock', () => {
  it('renders m:ss and never goes negative', () => {
    expect(formatClock(0)).toBe('0:00')
    expect(formatClock(5_000)).toBe('0:05')
    expect(formatClock(65_000)).toBe('1:05')
    expect(formatClock(600_000)).toBe('10:00')
    expect(formatClock(-500)).toBe('0:00')
  })
})
