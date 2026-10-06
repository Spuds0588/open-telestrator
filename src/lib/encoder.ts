/**
 * What to ask the encoder for.
 *
 * WebCodecs does the encoding, and which codecs it will actually give you
 * depends on the platform: WebView2 has hardware H.264, WKWebView usually does,
 * and WebKitGTK varies by version. So the *choice* is made here, from a list of
 * candidates and a "can you do this one" question, which keeps the decision
 * testable instead of buried in a hook that needs a GPU to run.
 *
 * H.264 for video because that is what every RTMP ingest accepts and what the
 * browser can encode in hardware. AAC for audio for the same reason — and this
 * is the sharp edge of the whole feature: a browser can always encode Opus, but
 * **RTMP platforms will not accept Opus**. When only Opus is available the
 * honest thing is to send the picture and say the sound is not going.
 */

/** Levels, as they appear in an H.264 codec string. */
const LEVEL_3_1 = '1f'
const LEVEL_4_0 = '28'
const LEVEL_5_1 = '33'

/**
 * The H.264 level a picture needs, from its macroblock count: the spec caps both
 * macroblocks per frame and macroblocks per second, and a level too low for the
 * picture is a stream that connects and then stutters or refuses frames.
 */
export function h264Level(width: number, height: number, frameRate: number): string {
  const macroblocks = Math.ceil(width / 16) * Math.ceil(height / 16)
  const perSecond = macroblocks * frameRate
  if (macroblocks <= 3600 && perSecond <= 108_000) return LEVEL_3_1
  if (macroblocks <= 8192 && perSecond <= 245_760) return LEVEL_4_0
  return LEVEL_5_1
}

/**
 * The H.264 configurations to try, best first: High and Main profiles compress
 * better and every ingest accepts them, with Baseline behind them for the
 * encoders that only do that.
 */
export function videoCodecCandidates(width: number, height: number, frameRate: number): string[] {
  const level = h264Level(width, height, frameRate)
  return [`avc1.6400${level}`, `avc1.4d00${level}`, `avc1.42e0${level}`]
}

/** The first candidate the platform says it can do, or null for none of them. */
export function pickVideoCodec(
  candidates: readonly string[],
  isSupported: (codec: string) => boolean,
): string | null {
  for (const codec of candidates) {
    if (isSupported(codec)) return codec
  }
  return null
}

/** AAC-LC, then Opus. Opus is a fallback that cannot go on air. */
export const AUDIO_CODECS = ['mp4a.40.2', 'opus'] as const
export type AudioCodec = (typeof AUDIO_CODECS)[number]

export function pickAudioCodec(
  isSupported: (codec: AudioCodec) => boolean,
): AudioCodec | null {
  for (const codec of AUDIO_CODECS) {
    if (isSupported(codec)) return codec
  }
  return null
}

/** Whether a platform will take this codec over RTMP. Only AAC, in practice. */
export function audioIsSendable(codec: AudioCodec): boolean {
  return codec === 'mp4a.40.2'
}

export interface AudioPlan {
  /** Whether to set an encoder up at all. */
  encode: boolean
  /** What to tell the user, or null when there is nothing to say. */
  warning: string | null
}

/**
 * What to do about audio. Sending Opus to an ingest that expects AAC produces a
 * stream whose audio track is silently dropped or, worse, one that never starts;
 * telling the operator the picture is going out silent is far better than either.
 */
export function audioPlan(codec: AudioCodec | null): AudioPlan {
  if (codec === null) {
    return {
      encode: false,
      warning: 'This machine has no audio encoder, so the stream will be silent.',
    }
  }
  if (!audioIsSendable(codec)) {
    return {
      encode: false,
      warning:
        'This machine can only encode Opus audio, and RTMP platforms need AAC — the stream will be video only.',
    }
  }
  return { encode: true, warning: null }
}

/** The lower bound worth sending: below this a 720p picture looks broken. */
const MIN_BITRATE = 1_500_000
/** The upper bound worth sending: platforms re-encode above it anyway. */
const MAX_BITRATE = 12_000_000

/**
 * A bitrate for the picture, at roughly a tenth of a bit per pixel per frame,
 * clamped to what a platform will accept without re-encoding anyway.
 */
export function encoderBitrate(width: number, height: number, frameRate: number): number {
  const raw = Math.round(width * height * frameRate * 0.1)
  return Math.min(MAX_BITRATE, Math.max(MIN_BITRATE, raw))
}

/**
 * How often to force a keyframe. Every two seconds is the usual compromise: a
 * platform can start a viewer on a keyframe this often, at the cost of a few
 * hundred kilobytes a second of extra bitrate.
 */
export const KEYFRAME_SECONDS = 2

/** Whether this frame should be forced to a keyframe. */
export function isKeyframeFrame(index: number, frameRate: number): boolean {
  return index % Math.max(1, Math.round(frameRate * KEYFRAME_SECONDS)) === 0
}
