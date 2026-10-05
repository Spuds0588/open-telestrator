import { useCallback, useEffect, useRef, useState } from 'react'
import type { CameraProblem } from './mediaErrors'

/**
 * Lifecycle of a media capture:
 *
 * - `idle`        nothing captured; the user can start.
 * - `requesting`  the browser picker/permission prompt is open.
 * - `live`        a stream is bound and playing.
 * - `denied`      the browser refused: the user dismissed the picker or capture
 *                 permission is blocked. Recoverable — the user can retry.
 * - `error`       an unexpected failure, described by `notice`.
 */
export type CaptureStatus = 'idle' | 'requesting' | 'live' | 'denied' | 'error'

export interface MediaCapture {
  status: CaptureStatus
  stream: MediaStream | null
  /** Human-readable explanation shown for the `denied` and `error` states. */
  notice: string | null
  /** Request a capture. A no-op while a request is in flight or already live. */
  start: () => Promise<void>
  /** Stop the capture and return to `idle`. */
  stop: () => void
}

const DISPLAY_CONSTRAINTS: DisplayMediaStreamOptions = {
  video: { displaySurface: 'browser' },
  audio: true,
}

function errorName(cause: unknown): string {
  return cause instanceof DOMException ? cause.name : cause instanceof Error ? cause.name : ''
}

/**
 * Maps a `getDisplayMedia` rejection onto a deliberate UI state.
 *
 * Callers handle `AbortError` separately (a clean dismissal returns to `idle`),
 * so this covers the remaining cases. `NotAllowedError` is deliberately treated
 * as `denied` for both a dismissed picker and a blocked permission: the Web
 * platform reports both with that name, so they cannot be told apart here.
 */
export function classifyCaptureError(cause: unknown): {
  status: Extract<CaptureStatus, 'denied' | 'error'>
  notice: string
} {
  const name = errorName(cause)
  const detail = cause instanceof Error ? cause.message : ''

  switch (name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return {
        status: 'denied',
        notice:
          'Screen sharing wasn’t started. Pick a tab to share, or allow screen capture for this site.',
      }
    case 'NotSupportedError':
      return {
        status: 'error',
        notice: 'This browser doesn’t support tab capture.',
      }
    case 'NotFoundError':
      return {
        status: 'error',
        notice: 'No screen or window was available to share.',
      }
    case 'InvalidStateError':
      return {
        status: 'error',
        notice: 'Screen capture couldn’t start while this page was in the background. Try again.',
      }
    default:
      return {
        status: 'error',
        notice: detail
          ? `Could not start screen capture (${name || 'unknown'}): ${detail}`
          : 'Could not start screen capture.',
      }
  }
}

interface CaptureOptions {
  /** Acquire the stream. Only valid from a user gesture. */
  request: () => Promise<MediaStream>
  /** Whether this browser exposes the API at all. */
  isSupported: () => boolean
  /** Notice shown for the `denied` and `error` states. */
  classify: (cause: unknown) => CameraProblem | ReturnType<typeof classifyCaptureError>
  /** Shown when a stream arrives without a video track. */
  missingTrackNotice: string
  /** Shown when the API itself is unavailable. */
  unsupportedNotice: string
}

/**
 * One capture lifecycle for every kind of input: acquire a stream, bind it,
 * and release it on stop, track-end, or unmount. Rejections are mapped to a
 * deliberate UI state instead of thrown at the stage.
 */
function useMediaCapture({
  request,
  isSupported,
  classify,
  missingTrackNotice,
  unsupportedNotice,
}: CaptureOptions): MediaCapture {
  const [status, setStatus] = useState<CaptureStatus>('idle')
  const [stream, setStream] = useState<MediaStream | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const streamRef = useRef<MediaStream | null>(null)
  const busyRef = useRef(false)
  const mountedRef = useRef(true)
  /** Bumped to invalidate any in-flight request (stop, track-end, unmount). */
  const requestRef = useRef(0)

  const release = useCallback((media: MediaStream | null) => {
    media?.getTracks().forEach((track) => track.stop())
  }, [])

  const stop = useCallback(() => {
    requestRef.current += 1
    busyRef.current = false
    release(streamRef.current)
    streamRef.current = null
    setStream(null)
    setStatus('idle')
    setNotice(null)
  }, [release])

  const start = useCallback(async () => {
    // Guard double-start: ignore clicks while a prompt is open or already live.
    if (busyRef.current || streamRef.current) return

    if (!isSupported()) {
      setStatus('error')
      setNotice(unsupportedNotice)
      return
    }

    busyRef.current = true
    const requestId = ++requestRef.current
    setNotice(null)
    setStatus('requesting')

    try {
      const captured = await request()

      // A stop() or unmount happened while the prompt was open: discard it.
      if (requestId !== requestRef.current || !mountedRef.current) {
        release(captured)
        return
      }

      const video = captured.getVideoTracks()[0]
      if (!video) {
        release(captured)
        setStatus('error')
        setNotice(missingTrackNotice)
        return
      }

      // The browser's own "Stop sharing" control ends the track directly.
      video.addEventListener('ended', () => {
        if (requestRef.current !== requestId) return
        requestRef.current += 1
        release(streamRef.current)
        streamRef.current = null
        setStream(null)
        setStatus('idle')
        setNotice(null)
      })

      streamRef.current = captured
      setStream(captured)
      setStatus('live')
    } catch (cause) {
      if (requestId !== requestRef.current) return
      if (cause instanceof DOMException && cause.name === 'AbortError') {
        // Dismissed before choosing a source: a clean reset, not an error.
        setStatus('idle')
        setNotice(null)
      } else {
        const { status: next, notice: text } = classify(cause)
        setStatus(next)
        setNotice(text)
      }
    } finally {
      busyRef.current = false
    }
  }, [classify, isSupported, missingTrackNotice, release, request, unsupportedNotice])

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      requestRef.current += 1
      release(streamRef.current)
      streamRef.current = null
    }
  }, [release])

  return { status, stream, notice, start, stop }
}

/**
 * Captures a user-selected tab/window/screen and exposes it as a MediaStream.
 *
 * The captured audio track stays on the stream for the stage audio mixer.
 * `getDisplayMedia` must be called from a user gesture, so `start` is wired
 * directly to a button click.
 */
export function useDisplayCapture(): MediaCapture {
  const isSupported = useCallback(
    () => typeof navigator.mediaDevices?.getDisplayMedia === 'function',
    [],
  )
  const request = useCallback(() => navigator.mediaDevices.getDisplayMedia(DISPLAY_CONSTRAINTS), [])
  return useMediaCapture({
    request,
    isSupported,
    classify: classifyCaptureError,
    missingTrackNotice: 'The selected source didn’t provide a video track.',
    unsupportedNotice: 'Screen capture isn’t available in this browser.',
  })
}
