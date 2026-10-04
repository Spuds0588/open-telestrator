import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import { ReplayBuffer, type ReplayClip } from './replay'

/** Slow-motion playback rate for replays. */
export const REPLAY_RATE = 0.5

export interface ReplayController {
  /** The clip being replayed, or null while showing live video. */
  clip: ReplayClip | null
  /** Whether a replay is possible right now. */
  available: boolean
  /** Length of the available replay window, in seconds. */
  windowSeconds: number
  replaying: boolean
  paused: boolean
  startReplay: () => void
  returnToLive: () => void
  togglePlay: () => void
}

/**
 * Owns the replay buffer for the current capture stream and exposes the small
 * amount of state the stage controls need. The buffer keeps recording while a
 * replay plays, so returning to live is instant and nothing is missed.
 */
export function useReplay(
  stream: MediaStream | null,
  videoRef: RefObject<HTMLVideoElement>,
): ReplayController {
  const bufferRef = useRef<ReplayBuffer | null>(null)
  if (bufferRef.current === null) bufferRef.current = new ReplayBuffer()
  const buffer = bufferRef.current

  const [clip, setClip] = useState<ReplayClip | null>(null)
  const [stats, setStats] = useState({ available: false, windowSeconds: 0 })
  const [paused, setPaused] = useState(false)

  // Tie the recorder's lifetime to the capture stream. A clip must never outlive
  // the capture it came from, so every stream change also drops the replay state:
  // stopping (or losing) capture can't leave stale footage playing on the stage.
  useEffect(() => {
    if (stream) buffer.start(stream)
    else buffer.stop()
    setClip(null)
    setPaused(false)
    return () => buffer.stop()
  }, [stream, buffer])

  // Poll once a second: enough for the controls, and far cheaper than a
  // re-render per captured chunk.
  useEffect(() => {
    if (!stream) {
      setStats({ available: false, windowSeconds: 0 })
      return
    }
    const read = () => {
      const next = buffer.getClip()
      setStats({
        available: next !== null,
        windowSeconds: next ? Math.round(next.seconds - next.startSeconds) : 0,
      })
    }
    read()
    const timer = window.setInterval(read, 1000)
    return () => window.clearInterval(timer)
  }, [stream, buffer])

  // Mirror the video element's play/pause so the control label stays honest.
  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    const onPlay = () => setPaused(false)
    const onPause = () => setPaused(true)
    video.addEventListener('play', onPlay)
    video.addEventListener('pause', onPause)
    return () => {
      video.removeEventListener('play', onPlay)
      video.removeEventListener('pause', onPause)
    }
  }, [videoRef])

  const startReplay = useCallback(() => {
    const next = buffer.getClip()
    if (!next) return
    setClip(next)
    setPaused(false)
  }, [buffer])

  const returnToLive = useCallback(() => {
    setClip(null)
    setPaused(false)
  }, [])

  const togglePlay = useCallback(() => {
    const video = videoRef.current
    if (!video) return
    if (video.paused) void video.play().catch(() => undefined)
    else video.pause()
  }, [videoRef])

  return {
    clip,
    available: stats.available,
    windowSeconds: stats.windowSeconds,
    replaying: clip !== null,
    paused,
    startReplay,
    returnToLive,
    togglePlay,
  }
}
