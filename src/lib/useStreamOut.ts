import { useCallback, useEffect, useRef, useState } from 'react'
import { mixBroadcastStream } from './broadcast'
import {
  DEFAULT_DESTINATION,
  connectionProblem,
  destinationProblem,
  silentWarning,
  streamTone,
  whipDelete,
  whipPost,
  type StreamState,
  type WhipDestination,
} from './whip'

export interface StreamOutController {
  state: StreamState
  /** Why the stream stopped, or why it would not start. */
  failure: string | null
  /** A non-fatal thing the operator should know — usually about audio. */
  warning: string | null
  destination: WhipDestination
  setDestination: (destination: WhipDestination) => void
  tone: 'live' | 'warn' | null
  /** Publish the program. */
  start: () => Promise<void>
  /** Hang up. */
  stop: () => Promise<void>
}

/** How long to wait for the compositor to have a picture before giving up. */
const PROGRAM_WAIT_MS = 2000

/** How often that wait looks. */
const PROGRAM_POLL_MS = 60

/**
 * How long to wait for ICE gathering before posting the offer anyway.
 *
 * WHIP allows trickle ICE, where candidates are sent as they are found and the
 * offer goes out immediately. This takes the simpler path — one complete offer,
 * one request — which means waiting for gathering to finish. On a network where
 * that never quite happens, waiting forever would be worse than posting what we
 * have, so there is a ceiling and the offer goes out with whatever was gathered.
 */
const ICE_WAIT_MS = 4000

/**
 * Stream-out, over WebRTC, with nothing installed.
 *
 * The studio composites the program onto a canvas, and that canvas stream is
 * already published to the app's own viewers. This sends the *same* picture to a
 * service that accepts WebRTC and forwards it on, which is what replaced the old
 * arrangement of encoding frames in the page and posting them to a native
 * publisher: there is no encoder here, no frame format and no process to install,
 * because the browser's own WebRTC stack does that work.
 *
 * The shape is one `POST` and one `DELETE`. The offer is created, gathered and
 * posted; the answer comes back in the response body; the connection then looks
 * after itself until either end gives up, and the service is told the resource is
 * finished when it does. Nothing polls, because a peer connection reports its own
 * state.
 *
 * `onAir` is owned by the caller rather than derived from `state` here, because
 * the compositor has to be running *before* the service is told a broadcast is
 * starting — the canvas stream does not exist until it is, and the first seconds
 * on air would otherwise be an empty frame. That is also why the hook waits for a
 * program rather than failing instantly: the wait is for our own compositor, not
 * for the network.
 */
export function useStreamOut({
  program,
  audio,
  onAirChange,
}: {
  /** The composited program, or a source to fall back on before it exists. */
  program: MediaStream | null
  /** The stage audio mix, so the broadcast is not silent. */
  audio: MediaStream | null
  /** Called with true before connecting and false as soon as it stops. */
  onAirChange: (onAir: boolean) => void
}): StreamOutController {
  const [destination, setDestination] = useState<WhipDestination>(DEFAULT_DESTINATION)
  const [state, setState] = useState<StreamState>('idle')
  const [failure, setFailure] = useState<string | null>(null)
  const [warning, setWarning] = useState<string | null>(null)

  const peerRef = useRef<RTCPeerConnection | null>(null)
  /** Where to send the teardown. Null until the service has answered. */
  const resourceRef = useRef<string | null>(null)
  /** The token as it was when the broadcast started, for its own teardown. */
  const tokenRef = useRef('')
  /** Set the moment anything is torn down, so late events are ignored. */
  const closedRef = useRef(false)

  // Read from inside `start` without making it depend on the picture, which
  // changes identity every time a stroke or a camera tick redraws the stage.
  const programRef = useRef<MediaStream | null>(program)
  const audioRef = useRef<MediaStream | null>(audio)
  useEffect(() => {
    programRef.current = program
    audioRef.current = audio
  }, [program, audio])

  const teardown = useCallback(() => {
    closedRef.current = true
    const resource = resourceRef.current
    resourceRef.current = null
    peerRef.current?.close()
    peerRef.current = null
    // Best effort: a teardown the service never hears only means it times the
    // broadcast out for itself.
    void whipDelete(resource, tokenRef.current)
  }, [])

  const stop = useCallback(async () => {
    teardown()
    onAirChange(false)
    setState('idle')
    setFailure(null)
    setWarning(null)
  }, [onAirChange, teardown])

  const start = useCallback(async () => {
    if (state === 'connecting' || state === 'live') return

    const problem = destinationProblem(destination)
    if (problem) {
      setState('error')
      setFailure(problem)
      return
    }

    setState('connecting')
    setFailure(null)
    setWarning(null)
    closedRef.current = false
    tokenRef.current = destination.token

    // Turn the compositor on first and wait for its picture.
    onAirChange(true)
    const picture = await waitForProgram(programRef)
    if (closedRef.current) return

    const stream = mixBroadcastStream(picture, audioRef.current)
    if (!stream) {
      onAirChange(false)
      setState('error')
      setFailure('There is no program to send yet. Add an input first.')
      return
    }
    setWarning(silentWarning(stream.getAudioTracks().length > 0))

    const peer = new RTCPeerConnection()
    peerRef.current = peer
    for (const track of stream.getTracks()) peer.addTrack(track, stream)

    peer.addEventListener('connectionstatechange', () => {
      if (closedRef.current || peerRef.current !== peer) return
      if (peer.connectionState === 'connected') {
        setState('live')
        setFailure(null)
        return
      }
      // A dropped connection may recover by itself, and this listener is still
      // watching, so the state flips back to live if it does.
      const reason = connectionProblem(peer.connectionState)
      if (!reason) return
      setState('error')
      setFailure(reason)
    })

    try {
      const offer = await peer.createOffer()
      await peer.setLocalDescription(offer)
      await waitForIce(peer)
      const local = peer.localDescription
      if (!local) throw new Error('the browser produced no offer to send')

      const published = await whipPost(destination.url.trim(), local.sdp, destination.token)
      if ('problem' in published) {
        teardown()
        onAirChange(false)
        setState('error')
        setFailure(published.problem)
        return
      }

      resourceRef.current = published.resource
      await peer.setRemoteDescription({ type: 'answer', sdp: published.answer })
      if (closedRef.current) return
      // The service has the answer; the picture is arriving from here on. The
      // connection state settles to `connected` a moment later and says the same
      // thing, but going live on the service's acceptance is what the operator
      // asked about.
      setState('live')
    } catch (cause) {
      teardown()
      onAirChange(false)
      setState('error')
      setFailure(cause instanceof Error ? cause.message : String(cause))
    }
  }, [destination, onAirChange, state, teardown])

  // Nothing may outlive the studio: a page unload with a broadcast running leaves
  // a service still expecting frames.
  useEffect(
    () => () => {
      closedRef.current = true
      peerRef.current?.close()
      peerRef.current = null
      const resource = resourceRef.current
      resourceRef.current = null
      void whipDelete(resource, tokenRef.current)
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

/**
 * Wait for the compositor to have a picture.
 *
 * The stream is created by `useProgramCompositor` once it is told to draw, which
 * happens on the render after `onAirChange(true)`, so the first look almost
 * always misses it. Polling a ref for a moment is the cheapest way to be right
 * about that without wiring a subscription through the two hooks.
 */
async function waitForProgram(ref: { current: MediaStream | null }): Promise<MediaStream | null> {
  const deadline = Date.now() + PROGRAM_WAIT_MS
  for (;;) {
    const current = ref.current
    if (current && current.getVideoTracks().length > 0) return current
    if (Date.now() >= deadline) return null
    await new Promise((resolve) => window.setTimeout(resolve, PROGRAM_POLL_MS))
  }
}

/** Resolve once ICE gathering is done, or once waiting any longer stops helping. */
function waitForIce(peer: RTCPeerConnection): Promise<void> {
  if (peer.iceGatheringState === 'complete') return Promise.resolve()
  return new Promise((resolve) => {
    const finish = () => {
      window.clearTimeout(timer)
      peer.removeEventListener('icegatheringstatechange', check)
      resolve()
    }
    const check = () => {
      if (peer.iceGatheringState === 'complete') finish()
    }
    const timer = window.setTimeout(finish, ICE_WAIT_MS)
    peer.addEventListener('icegatheringstatechange', check)
  })
}
