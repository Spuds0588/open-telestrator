import { useCallback, useEffect, useRef, useState } from 'react'
import { PLATFORMS, destinationProblem, streamTone, type Destination, type StreamState } from './streamOut'
import { isDesktop, streamFailure, streamStart, streamStop } from './desktop'
// Type only, so the pipeline itself stays out of the studio's chunk: nothing on
// the web can open an RTMP socket, and the encoder is dead weight there. It is
// fetched the first time somebody actually starts a stream.
import type { ProgramEncoder } from './programEncoder'

export interface StreamOutController {
  state: StreamState
  /** Why the stream stopped, or why it would not start. */
  failure: string | null
  /** A non-fatal thing the operator should know — usually about audio. */
  warning: string | null
  destination: Destination
  setDestination: (destination: Destination) => void
  tone: 'live' | 'warn' | null
  /** Connect and start encoding. */
  start: () => Promise<void>
  stop: () => Promise<void>
}

/** How often to ask the shell whether the publisher is still alive. */
const STATUS_POLL_MS = 1500

/**
 * Stream-out, as the app drives it.
 *
 * The shell cannot composite and the webview cannot open an RTMP socket, so this
 * hook is the seam: it turns the compositor on so there is a program to encode,
 * lets the shell connect, then feeds it encoded frames until something stops.
 *
 * `onAir` is owned by the caller rather than derived from `state` here, because
 * the compositor has to be running *before* the publisher connects — otherwise
 * the first seconds of the stream are an empty canvas. That is the whole reason
 * it is a separate flag and not `state !== 'idle'`.
 */
export function useStreamOut({
  source,
  audio,
  onAirChange,
}: {
  /** The element showing the composited program, once the compositor runs. */
  source: React.RefObject<HTMLVideoElement>
  audio: MediaStream | null
  /** Called with true before connecting and false as soon as it stops. */
  onAirChange: (onAir: boolean) => void
}): StreamOutController {
  const [destination, setDestination] = useState<Destination>(() => ({
    address: PLATFORMS[0]?.address ?? '',
    key: '',
  }))
  const [state, setState] = useState<StreamState>('idle')
  const [failure, setFailure] = useState<string | null>(null)
  const [warning, setWarning] = useState<string | null>(null)
  const encoderRef = useRef<ProgramEncoder | null>(null)

  const teardown = useCallback(() => {
    encoderRef.current?.close()
    encoderRef.current = null
  }, [])

  const stop = useCallback(async () => {
    teardown()
    await streamStop()
    onAirChange(false)
    setState('idle')
    setFailure(null)
  }, [onAirChange, teardown])

  const start = useCallback(async () => {
    if (state === 'connecting' || state === 'live') return
    if (!isDesktop()) {
      setState('error')
      setFailure('Streaming out needs the desktop app.')
      return
    }
    const problem = destinationProblem(destination.address, destination.key)
    if (problem) {
      setState('error')
      setFailure(problem)
      return
    }

    const element = source.current
    if (!element) {
      setState('error')
      setFailure('There is no program to send yet.')
      return
    }

    setState('connecting')
    setFailure(null)
    setWarning(null)

    // Turn the compositor on first and give it a moment: the shell must not be
    // told a stream is starting before there is a picture for it.
    onAirChange(true)
    await new Promise((resolve) => requestAnimationFrame(() => resolve(null)))
    await new Promise((resolve) => window.setTimeout(resolve, 120))

    const width = element.videoWidth || 1280
    const height = element.videoHeight || 720
    // The stage is 16:9 by construction, and an ingest wants the standard shape
    // rather than whatever the first frame happened to be.
    const frameRate = 30

    const error = await streamStart({
      url: destination.address.trim(),
      key: destination.key.trim(),
      width,
      height,
      frameRate,
      audioSampleRate: 48_000,
      audioChannels: 2,
    })
    if (error) {
      onAirChange(false)
      setState('error')
      setFailure(error)
      return
    }

    try {
      const { startProgramEncoder } = await import('./programEncoder')
      encoderRef.current = await startProgramEncoder({
        source: element,
        audio,
        width,
        height,
        frameRate,
        onError: (reason) => {
          teardown()
          onAirChange(false)
          setState('error')
          setFailure(reason)
        },
        onWarning: setWarning,
      })
      setState('live')
    } catch (cause) {
      await streamStop()
      onAirChange(false)
      setState('error')
      setFailure(cause instanceof Error ? cause.message : String(cause))
    }
  }, [audio, destination, onAirChange, source, state, teardown])

  // The publisher can die on its own — the platform drops the connection, the
  // key expires — and nothing else would notice, because no local call fails.
  useEffect(() => {
    if (state !== 'live') return
    const timer = window.setInterval(async () => {
      const reason = await streamFailure()
      if (reason === null) return
      teardown()
      onAirChange(false)
      setState('error')
      setFailure(reason)
    }, STATUS_POLL_MS)
    return () => window.clearInterval(timer)
  }, [state, teardown, onAirChange])

  // Nothing may outlive the app: a page unload with an encoder running leaves a
  // platform thinking the stream is still coming.
  useEffect(
    () => () => {
      encoderRef.current?.close()
      encoderRef.current = null
      void streamStop()
    },
    [],
  )

  return {
    state,
    failure,
    warning,
    destination,
    setDestination,
    tone: streamTone(state),
    start,
    stop,
  }
}
