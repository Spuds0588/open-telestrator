import { useCallback, useEffect, useRef, useState } from 'react'
import Peer, { type DataConnection, type MediaConnection } from 'peerjs'
import {
  VIEWERS_REPORT_MS,
  buildCameraLink,
  createToken,
  parseRole,
  viewersReport,
  type CameraRole,
} from './cameraLink'
import { parseCollabOp, syncOp, type CollabOp } from './collab'
import { peerOptions } from './peerConfig'
import type { Stroke } from './telestration'

/** A remote camera feed that has connected and is streaming to this host. */
export interface CameraSource {
  /** The cameraman's PeerJS id — stable for the life of its call. */
  id: string
  label: string
  stream: MediaStream
}

/** A co-host currently connected over the camera link's data channel. */
export interface CoHost {
  /** The co-host's PeerJS id, stable for the life of its channel. */
  id: string
  /** Short, stable handle to show in the sidebar. */
  label: string
  /** True when it is also streaming a camera into the Sources list. */
  streaming: boolean
}

export type HostCameraStatus = 'idle' | 'opening' | 'ready' | 'error'

/** The shared-drawing side of a co-host session. */
export interface HostCameraCollab {
  /** The host's committed strokes: sent to a co-host so it starts in sync. */
  strokes: readonly Stroke[]
  /** A drawing operation from a co-host, for the host to apply. */
  onRemoteOp: (op: CollabOp) => void
}

export interface HostCamera {
  status: HostCameraStatus
  notice: string | null
  /** The co-host magic link, once the peer is open: drawing, camera, mic. */
  link: string | null
  /**
   * The camera-only link for the same session: a phone that sends its camera and
   * microphone and is offered no drawing surface. Same peer, same token — the
   * difference is the door the person came through.
   */
  cameraLink: string | null
  /** Every camera currently streaming in, newest last. */
  sources: CameraSource[]
  /** Every connected co-host, the moment its channel opens. */
  cohosts: CoHost[]
  /** Drop one co-host: its camera, its program and its drawing channel. */
  disconnect: (id: string) => void
  /** Send a drawing operation to every connected co-host. */
  sendOp: (op: CollabOp) => void
  /** Publish the picture co-hosts draw on; a change re-issues it. */
  publishProgram: (stream: MediaStream | null) => void
  /** Open a signaling peer and mint this session's link. */
  createLink: () => void
  /** Tear the session down and drop every camera. */
  stop: () => void
}

/**
 * Host side of the magic-link cameraman feature.
 *
 * One PeerJS peer receives incoming media calls. A call is only answered when
 * its metadata carries this session's token; every other call is closed without
 * an answer. `answer()` is called with **no stream**, so the camera path is
 * strictly one-way: nothing from the stage is sent back over it.
 *
 * A co-host link also opens a token-checked data channel. The host repeats the
 * viewer count down it, sends the program picture as a separate call so the
 * co-host has something to draw on, and both directions exchange drawing
 * operations. The host owns the stroke stack: it applies what a co-host sends,
 * forwards it to the other co-hosts, and never accepts a `sync` from a co-host.
 */
export function useHostCamera(
  viewers: number,
  { strokes, onRemoteOp }: HostCameraCollab,
): HostCamera {
  const [status, setStatus] = useState<HostCameraStatus>('idle')
  const [notice, setNotice] = useState<string | null>(null)
  const [link, setLink] = useState<string | null>(null)
  const [cameraLink, setCameraLink] = useState<string | null>(null)
  const [sources, setSources] = useState<CameraSource[]>([])
  const [cohosts, setCohosts] = useState<CoHost[]>([])

  const peerRef = useRef<Peer | null>(null)
  const tokenRef = useRef<string | null>(null)
  const callsRef = useRef(new Map<string, MediaConnection>())
  /** Co-hosts listening for the viewer count and swapping drawing operations. */
  const connsRef = useRef(new Map<string, DataConnection>())
  /**
   * Which connections came through the camera door. They are handed no program
   * picture and no stroke stack, because they have nothing to draw on.
   */
  const cameraRolesRef = useRef(new Set<string>())
  /** The program call made to each co-host, so it can be replaced or closed. */
  const programCallsRef = useRef(new Map<string, MediaConnection>())
  const viewersRef = useRef(viewers)
  const strokesRef = useRef(strokes)
  const programRef = useRef<MediaStream | null>(null)
  const onRemoteOpRef = useRef(onRemoteOp)

  const sendReport = useCallback((conn: DataConnection) => {
    if (conn.open) conn.send(viewersReport(viewersRef.current))
  }, [])

  /** Push the current count to every co-host that is listening. */
  const reportViewers = useCallback(() => {
    if (connsRef.current.size === 0) return
    for (const conn of connsRef.current.values()) sendReport(conn)
  }, [sendReport])

  // Send on every change so the number moves as soon as it does, but never less
  // often than the repeating timer below.
  useEffect(() => {
    viewersRef.current = viewers
    reportViewers()
  }, [viewers, reportViewers])

  useEffect(() => {
    strokesRef.current = strokes
  }, [strokes])

  useEffect(() => {
    onRemoteOpRef.current = onRemoteOp
  }, [onRemoteOp])

  /**
   * Hand a co-host the program picture. A media call cannot swap its track, so
   * a changed program is a fresh call: the previous one is closed first.
   */
  const sendProgram = useCallback((id: string, stream: MediaStream | null) => {
    const peer = peerRef.current
    if (!peer) return
    const existing = programCallsRef.current.get(id)
    programCallsRef.current.delete(id)
    existing?.close()
    if (!stream) return
    const call = peer.call(id, stream)
    programCallsRef.current.set(id, call)
    call.on('close', () => {
      if (programCallsRef.current.get(id) === call) programCallsRef.current.delete(id)
    })
  }, [])

  /** Rebuild the connected list from the live channels and camera calls. */
  const syncCohosts = useCallback(() => {
    setCohosts(
      [...connsRef.current.keys()].map((id) => ({
        id,
        // Named for the door it came through, so a phone that is only a camera
        // is not mistaken for somebody who can draw.
        label: `${cameraRolesRef.current.has(id) ? 'Camera' : 'Co-host'} ${id.slice(0, 4)}`,
        streaming: callsRef.current.has(id),
      })),
    )
  }, [])

  /** Drop a single co-host: channel, camera and program call, in that order. */
  const disconnect = useCallback(
    (id: string) => {
      const conn = connsRef.current.get(id)
      if (conn) {
        // Delete first so the channel's own close handler leaves our cleanup be.
        connsRef.current.delete(id)
        conn.close()
      }
      const cameraCall = callsRef.current.get(id)
      if (cameraCall) {
        callsRef.current.delete(id)
        cameraCall.close()
        setSources((prev) => prev.filter((source) => source.id !== id))
      }
      const programCall = programCallsRef.current.get(id)
      if (programCall) {
        programCallsRef.current.delete(id)
        programCall.close()
      }
      syncCohosts()
    },
    [syncCohosts],
  )

  /** Send a drawing operation to every co-host, the sender included. */
  const sendOp = useCallback((op: CollabOp) => {
    for (const conn of connsRef.current.values()) {
      if (conn.open) conn.send(op)
    }
  }, [])

  /** Forward a co-host's operation to the others; the originator already has it. */
  const forwardOp = useCallback((exceptId: string, op: CollabOp) => {
    for (const [id, conn] of connsRef.current) {
      if (id === exceptId) continue
      if (conn.open) conn.send(op)
    }
  }, [])

  /** Publish the program picture; a change is re-offered to every co-host. */
  const publishProgram = useCallback(
    (stream: MediaStream | null) => {
      if (programRef.current === stream) return
      programRef.current = stream
      for (const id of [...connsRef.current.keys()]) {
        if (cameraRolesRef.current.has(id)) continue
        sendProgram(id, stream)
      }
    },
    [sendProgram],
  )

  const closeAll = useCallback(() => {
    for (const call of callsRef.current.values()) call.close()
    callsRef.current.clear()
    for (const call of programCallsRef.current.values()) call.close()
    programCallsRef.current.clear()
    for (const conn of connsRef.current.values()) conn.close()
    connsRef.current.clear()
    cameraRolesRef.current.clear()
    peerRef.current?.destroy()
    peerRef.current = null
    tokenRef.current = null
    setSources([])
    setCohosts([])
    setLink(null)
    setCameraLink(null)
  }, [])

  const stop = useCallback(() => {
    closeAll()
    setStatus('idle')
    setNotice(null)
  }, [closeAll])

  // Never leave a peer, its calls or its data channels alive past unmount.
  useEffect(
    () => () => {
      for (const call of callsRef.current.values()) call.close()
      callsRef.current.clear()
      for (const call of programCallsRef.current.values()) call.close()
      programCallsRef.current.clear()
      for (const conn of connsRef.current.values()) conn.close()
      connsRef.current.clear()
      cameraRolesRef.current.clear()
      peerRef.current?.destroy()
      peerRef.current = null
    },
    [],
  )

  // While a camera session is open, repeat the count on a timer: the co-host's
  // number has to survive a dropped message, and it costs a few bytes.
  useEffect(() => {
    if (status !== 'ready') return
    const timer = window.setInterval(reportViewers, VIEWERS_REPORT_MS)
    return () => window.clearInterval(timer)
  }, [status, reportViewers])

  const createLink = useCallback(() => {
    if (peerRef.current) return
    setStatus('opening')
    setNotice(null)

    const token = createToken()
    tokenRef.current = token
    // No id is supplied: the signaling server assigns one, so two hosts never
    // collide and a fresh link is a fresh session.
    const peer = new Peer(peerOptions())
    peerRef.current = peer

    peer.on('open', (id) => {
      // One session, two links: the same peer and the same token, so either door
      // reaches this host, and the role only decides what the phone is offered.
      setLink(buildCameraLink(window.location.href, { hostId: id, token, role: 'cohost' }))
      setCameraLink(buildCameraLink(window.location.href, { hostId: id, token, role: 'camera' }))
      setStatus('ready')
    })

    peer.on('error', (error) => {
      setStatus('error')
      setNotice(`Camera link unavailable (${error.type}).`)
    })

    peer.on('call', (call) => {
      const metadata = call.metadata as { token?: string } | undefined
      if (!metadata || metadata.token !== tokenRef.current) {
        // Wrong or missing token: close without answering, so no media is ever
        // established in either direction.
        call.close()
        return
      }

      // Answer with no stream — the host never sends media back on this call.
      call.answer()

      const id = call.peer
      call.on('stream', (remote) => {
        setSources((prev) =>
          prev.some((source) => source.id === id)
            ? prev
            : [...prev, { id, label: `Camera ${id.slice(0, 4)}`, stream: remote }],
        )
        syncCohosts()
      })
      call.on('close', () => {
        callsRef.current.delete(id)
        setSources((prev) => prev.filter((source) => source.id !== id))
        syncCohosts()
      })
      callsRef.current.set(id, call)
    })

    // The co-host's channel: viewer count out, drawing operations both ways.
    // Same token check as a media call, so a guessed link cannot subscribe.
    peer.on('connection', (conn) => {
      const metadata = conn.metadata as { token?: string } | undefined
      if (!metadata || metadata.token !== tokenRef.current) {
        conn.close()
        return
      }
      connsRef.current.set(conn.peer, conn)
      const role: CameraRole = parseRole(
        (conn.metadata as { role?: string } | undefined)?.role ?? null,
      )
      if (role === 'camera') cameraRolesRef.current.add(conn.peer)
      else cameraRolesRef.current.delete(conn.peer)
      syncCohosts()

      conn.on('data', (raw) => {
        const op = parseCollabOp(raw)
        if (!op) return
        // The host owns the stack: a co-host may add to it, never replace it.
        if (op.t === 'sync') return
        onRemoteOpRef.current(op)
        forwardOp(conn.peer, op)
      })

      conn.on('close', () => {
        if (connsRef.current.get(conn.peer) === conn) connsRef.current.delete(conn.peer)
        cameraRolesRef.current.delete(conn.peer)
        const programCall = programCallsRef.current.get(conn.peer)
        programCall?.close()
        programCallsRef.current.delete(conn.peer)
        syncCohosts()
      })

      // Ready: report the current count, start the co-host from the strokes
      // that are already on air, and offer it the program to draw on. A camera
      // link is none of that — it is a picture and a microphone — so it is sent
      // only the count its page can show.
      const ready = () => {
        sendReport(conn)
        if (role === 'camera') return
        conn.send(syncOp(strokesRef.current))
        sendProgram(conn.peer, programRef.current)
      }
      if (conn.open) ready()
      else conn.on('open', ready)
    })
  }, [forwardOp, sendProgram, sendReport, syncCohosts])

  return {
    status,
    notice,
    link,
    cameraLink,
    sources,
    cohosts,
    disconnect,
    sendOp,
    publishProgram,
    createLink,
    stop,
  }
}
