import { describe, expect, it } from 'vitest'
import {
  AUDIO_CODECS,
  audioIsSendable,
  audioPlan,
  encoderBitrate,
  h264Level,
  isKeyframeFrame,
  pickAudioCodec,
  pickVideoCodec,
  videoCodecCandidates,
} from './encoder'

describe('h264Level', () => {
  it('gives 720p and below a level that covers it', () => {
    expect(h264Level(1280, 720, 30)).toBe('1f')
    expect(h264Level(640, 480, 30)).toBe('1f')
  })

  it('raises the level for 1080p', () => {
    // 1080p is 8160 macroblocks a frame, past level 3.1's 3600.
    expect(h264Level(1920, 1080, 30)).toBe('28')
  })

  it('raises it again for 4K', () => {
    expect(h264Level(3840, 2160, 30)).toBe('33')
  })

  it('accounts for frame rate, not just the picture', () => {
    // The macroblock-per-second cap is a separate limit from the per-frame one.
    expect(h264Level(1280, 720, 30)).toBe('1f')
    expect(h264Level(1280, 720, 60)).not.toBe('1f')
  })
})

describe('videoCodecCandidates', () => {
  it('offers the level the picture needs, High profile first', () => {
    const candidates = videoCodecCandidates(1920, 1080, 30)
    expect(candidates[0]).toBe('avc1.640028')
    expect(candidates).toContain('avc1.42e028')
  })

  it('gives three distinct candidates so a fallback is always left', () => {
    const candidates = videoCodecCandidates(1280, 720, 30)
    expect(new Set(candidates).size).toBe(3)
    expect(candidates.every((codec) => codec.startsWith('avc1.'))).toBe(true)
  })
})

describe('pickVideoCodec', () => {
  const candidates = ['high', 'main', 'baseline']

  it('takes the best one the platform offers', () => {
    expect(pickVideoCodec(candidates, () => true)).toBe('high')
    expect(pickVideoCodec(candidates, (codec) => codec === 'baseline')).toBe('baseline')
    expect(pickVideoCodec(candidates, (codec) => codec !== 'high')).toBe('main')
  })

  it('says so when there is nothing to encode with', () => {
    expect(pickVideoCodec(candidates, () => false)).toBeNull()
    expect(pickVideoCodec([], () => true)).toBeNull()
  })
})

describe('pickAudioCodec', () => {
  it('prefers AAC, which is the one a platform accepts', () => {
    expect(pickAudioCodec(() => true)).toBe('mp4a.40.2')
  })

  it('falls back to Opus, and only then gives up', () => {
    expect(pickAudioCodec((codec) => codec === 'opus')).toBe('opus')
    expect(pickAudioCodec(() => false)).toBeNull()
  })

  it('knows which codecs can actually go on air', () => {
    expect(audioIsSendable('mp4a.40.2')).toBe(true)
    expect(audioIsSendable('opus')).toBe(false)
  })
})

describe('audioPlan', () => {
  it('sends AAC without a word about it', () => {
    expect(audioPlan('mp4a.40.2')).toEqual({ encode: true, warning: null })
  })

  it('refuses to send Opus, and says why', () => {
    const plan = audioPlan('opus')
    expect(plan.encode).toBe(false)
    expect(plan.warning).toMatch(/AAC/)
    expect(plan.warning).toMatch(/video only/i)
  })

  it('says the stream will be silent when there is no encoder at all', () => {
    const plan = audioPlan(null)
    expect(plan.encode).toBe(false)
    expect(plan.warning).toMatch(/silent/i)
  })

  it('never asks for an encoder it cannot have', () => {
    for (const codec of [...AUDIO_CODECS, null] as const) {
      const plan = audioPlan(codec)
      expect(plan.encode).toBe(codec === 'mp4a.40.2')
    }
  })
})

describe('encoderBitrate', () => {
  it('gives 1080p a bitrate a platform will take as-is', () => {
    const bitrate = encoderBitrate(1920, 1080, 30)
    expect(bitrate).toBeGreaterThan(4_000_000)
    expect(bitrate).toBeLessThanOrEqual(12_000_000)
  })

  it('scales down for a small picture but not below the floor', () => {
    expect(encoderBitrate(640, 360, 30)).toBe(1_500_000)
  })

  it('does not climb past what a platform would re-encode anyway', () => {
    expect(encoderBitrate(3840, 2160, 60)).toBe(12_000_000)
  })
})

describe('isKeyframeFrame', () => {
  it('forces a keyframe every two seconds', () => {
    expect(isKeyframeFrame(0, 30)).toBe(true)
    expect(isKeyframeFrame(1, 30)).toBe(false)
    expect(isKeyframeFrame(59, 30)).toBe(false)
    expect(isKeyframeFrame(60, 30)).toBe(true)
  })

  it('still marks frames when the frame rate is nonsense', () => {
    // A zero would divide by zero. The interval floors at one frame, which is
    // degenerate but harmless: every frame a keyframe is a valid encode.
    expect(isKeyframeFrame(0, 0)).toBe(true)
    expect(isKeyframeFrame(1, 0)).toBe(true)
    expect(isKeyframeFrame(2, 0)).toBe(true)
  })
})
