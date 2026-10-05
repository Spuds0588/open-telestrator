/**
 * Viewer playback helpers.
 *
 * The viewer is a live stream, so the controls are the familiar online-video
 * ones — play/pause, volume, full screen, picture-in-picture, cast — without any
 * of the seeking a recorded file would offer. There is no timeline to scrub: the
 * only meaningful positions are "live" and "the bit I have buffered locally
 * while paused".
 */

/** Volume is a 0–1 fraction everywhere; anything else is clamped into range. */
export function clampVolume(value: number): number {
  if (!Number.isFinite(value)) return 0
  if (value < 0) return 0
  if (value > 1) return 1
  return value
}

/** Move the volume by `delta`, staying inside 0–1. */
export function stepVolume(current: number, delta: number): number {
  return clampVolume(clampVolume(current) + delta)
}

/** The speaker glyph for a volume/mute combination. */
export function volumeGlyph(volume: number, muted: boolean): string {
  if (muted || clampVolume(volume) === 0) return '🔇'
  return clampVolume(volume) < 0.5 ? '🔉' : '🔊'
}

/** What the cast button should say about itself. */
export type CastState = 'unsupported' | 'available' | 'connecting' | 'connected'

/**
 * The Remote Playback API is the only in-page way to hand a video to a TV, so a
 * browser that does not implement it must not be shown a button that cannot
 * work. Where it does exist, the browser's own state drives the button.
 */
export function castState(
  hasRemoteApi: boolean,
  state: 'disconnected' | 'connecting' | 'connected' | null,
): CastState {
  if (!hasRemoteApi) return 'unsupported'
  if (state === 'connected') return 'connected'
  if (state === 'connecting') return 'connecting'
  return 'available'
}

/**
 * Codecs a pause buffer can be recorded in, best first. WebM is what Chrome and
 * Firefox produce; Safari records MP4. A browser that supports none of these
 * gets no pause buffer rather than a broken one.
 */
export const RECORDER_MIME_CANDIDATES = [
  'video/webm;codecs=vp9,opus',
  'video/webm;codecs=vp8,opus',
  'video/webm',
  'video/mp4',
] as const

/** The first recordable type the browser accepts, or null when there is none. */
export function pickRecorderMime(isSupported: (type: string) => boolean): string | null {
  for (const type of RECORDER_MIME_CANDIDATES) {
    if (isSupported(type)) return type
  }
  return null
}

/**
 * How much paused video is worth keeping. A viewer who leaves the tab paused
 * overnight must not accumulate gigabytes, so the buffer simply stops growing —
 * resuming then plays what was kept and rejoins live.
 */
export const PAUSE_BUFFER_LIMIT_MS = 120_000

/** Whether the pause buffer has been held long enough to stop recording. */
export function bufferLimitReached(elapsedMs: number): boolean {
  return elapsedMs >= PAUSE_BUFFER_LIMIT_MS
}

/**
 * Whether buffered playback has run past what was recorded.
 *
 * A recording handed to a media element has no duration in its header — Chrome
 * reports `Infinity` for it — so `ended` cannot be trusted to arrive. The viewer
 * compares the position against the wall-clock length instead, which returns it
 * to live even on the browsers that never fire the event.
 */
export function backlogFinished(positionMs: number, recordedMs: number, tailMs = 300): boolean {
  if (recordedMs <= 0) return false
  return positionMs >= Math.max(0, recordedMs - tailMs)
}

/** `m:ss` for the paused-backlog readout, saturating at an hour. */
export function formatClock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const minutes = Math.floor(total / 60)
  const seconds = total % 60
  return `${minutes}:${seconds.toString().padStart(2, '0')}`
}
