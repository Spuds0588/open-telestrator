/**
 * Rolling instant-replay buffer.
 *
 * A single `MediaRecorder` records the captured video track and we keep the most
 * recent footage available for slow-motion review.
 *
 * Why whole recording sessions instead of a chunk ring: WebM from
 * `MediaRecorder` carries the EBML header only in its first chunk, and a blob
 * that keeps the header but drops early clusters does *not* decode the retained
 * tail (the player holds the stale frame instead of seeking to the recent
 * clusters — verified against Chromium, including with `SourceBuffer.remove`,
 * which empties the buffer). So we never splice chunks. Once a session reaches
 * `windowSeconds` it is closed, kept as the fallback clip, and a fresh session
 * starts. Every clip handed out is a complete, playable WebM.
 */

export interface ReplayClip {
  /** A complete WebM recording — always playable on its own. */
  blob: Blob
  /** Total footage in the clip, in seconds. */
  seconds: number
  /** Offset to begin playback at so the clip covers the most recent window. */
  startSeconds: number
}

export interface ReplayBufferOptions {
  /** Seconds recorded per session before rotating to a fresh one. */
  windowSeconds?: number
  /** `MediaRecorder` timeslice in milliseconds. */
  chunkMs?: number
  /** Seconds of footage a replay starts with. */
  replaySeconds?: number
  /** Minimum footage a clip must hold before it is worth replaying. */
  minSeconds?: number
}

const MIME_TYPES = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm']

function pickMimeType(): string | null {
  if (typeof MediaRecorder === 'undefined') return null
  return MIME_TYPES.find((type) => MediaRecorder.isTypeSupported(type)) ?? null
}

interface Session {
  recorder: MediaRecorder
  /** Chunks belonging to *this* session only. */
  chunks: Blob[]
  startedAt: number
  mimeType: string
}

export class ReplayBuffer {
  private readonly windowSeconds: number
  private readonly chunkMs: number
  private readonly replaySeconds: number
  private readonly minSeconds: number

  private stream: MediaStream | null = null
  private session: Session | null = null
  private finished: ReplayClip | null = null

  constructor(options: ReplayBufferOptions = {}) {
    this.windowSeconds = options.windowSeconds ?? 30
    this.chunkMs = options.chunkMs ?? 1000
    this.replaySeconds = options.replaySeconds ?? 10
    // Kept at the chunk interval: after a rotation the fresh session is usable
    // as soon as its first chunk lands, so this is all the stale window there is.
    this.minSeconds = options.minSeconds ?? 1
  }

  /** False when this browser cannot record the capture at all. */
  get supported(): boolean {
    return pickMimeType() !== null
  }

  /** Begin recording `stream`. Replaces any previous recording. */
  start(stream: MediaStream): void {
    this.stop()
    const videoTrack = stream.getVideoTracks()[0]
    if (!videoTrack || !this.supported) return
    // Video only: audio mixing is a separate milestone.
    this.stream = new MediaStream([videoTrack])
    this.openSession()
  }

  /** Stop recording and drop every clip. */
  stop(): void {
    const session = this.session
    this.session = null
    this.stream = null
    this.finished = null
    if (session && session.recorder.state !== 'inactive') session.recorder.stop()
  }

  /**
   * The freshest usable clip.
   *
   * The live session always holds the most recent footage, so it wins as soon as
   * it is long enough to be worth replaying. The session that just finished is
   * only a stand-in while the new one warms up, and a session delivers its first
   * chunk one timeslice after it starts — so a rotation costs at most a
   * timeslice of staleness, never the whole `replaySeconds` window.
   */
  getClip(): ReplayClip | null {
    const live = this.session ? this.clipOf(this.session) : null
    if (live && live.seconds >= this.minSeconds) return live
    const fallback = this.finished ?? live
    return fallback && fallback.seconds >= this.minSeconds ? fallback : null
  }

  private clipOf(session: Session): ReplayClip | null {
    // A session that has not delivered a chunk yet has nothing to play.
    if (session.chunks.length === 0) return null
    const seconds = (Date.now() - session.startedAt) / 1000
    return {
      blob: new Blob(session.chunks, { type: session.mimeType }),
      seconds,
      startSeconds: Math.max(0, seconds - this.replaySeconds),
    }
  }

  private openSession(): void {
    const stream = this.stream
    const mimeType = pickMimeType()
    if (!stream || !mimeType) return

    const recorder = new MediaRecorder(stream, { mimeType })
    const session: Session = { recorder, chunks: [], startedAt: Date.now(), mimeType }

    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) session.chunks.push(event.data)
      if (
        this.session === session &&
        Date.now() - session.startedAt >= this.windowSeconds * 1000
      ) {
        this.rotate(session)
      }
    }

    recorder.start(this.chunkMs)
    this.session = session
  }

  private rotate(session: Session): void {
    if (this.session !== session) return
    const clip = this.clipOf(session)
    if (clip) this.finished = clip
    this.session = null
    if (session.recorder.state !== 'inactive') session.recorder.stop()
    this.openSession()
  }
}
