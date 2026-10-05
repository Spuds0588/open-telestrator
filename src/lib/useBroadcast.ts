import { useCallback, useEffect, useRef, useState } from 'react'
import Peer, { type DataConnection, type MediaConnection } from 'peerjs'
import {
  MAX_CHILDREN,
  SWEEP_MS,
  buildViewerLink,
  chooseParent,
  isReservationStale,
  isViewerGone,
  parseBroadcastMessage,
  type BroadcastMessage,
  type Candidate,
} from './broadcast'
import { createToken } from './cameraLink'
import { peerOptions } from './peerConfig'

export type BroadcastStatus = 'idle' | 'opening' | 'live' | 'error'

export interface BroadcastController {
  status: BroadcastStatus
  notice: string | null
  /** The viewer link, once the signaling peer is open. */
  link: string | null
  /** Viewers currently being fed anywhere in the tree. */
  viewers: number
  start: () => void
  stop: () => void
  /** Publish (or replace) the stream viewers receive. */
  setStream: (stream: MediaStream | null) => void
}

/**
 * Host side of the viewer tree.
 *
 * The host is the root: every viewer connects a data channel to it and asks for
 * a place in the tree. The host answers with a parent — itself or another
 * viewer with free capacity — and that parent calls the viewer with the live
 * stream. Every viewer also relays what it receives, so the host's uplink only
 * ever carries MAX_CHILDREN streams no matter how many people watch.
 *
 * No catch-up is attempted: a joining viewer gets whatever arrives from then
 * on, and viewers run independently of each other.
 */
export function useBroadcast(): BroadcastController {
  const [status, setStatus] = useState<BroadcastStatus>('idle')
  const [notice, setNotice] = useState<string | null>(null)
  const [link, setLink] = useState<string | null>(null)
  const [viewers, setViewers] = useState(0)

  const peerRef = useRef<Peer | null>(null)
  const tokenRef = useRef<string | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const liveRef = useRef(false)
  const connsRef = useRef(new Map<string, DataConnection>())
  const callsRef = useRef(new Map<string, MediaConnection>())
  /** Reported child counts from relay viewers. */
  const relaysRef = useRef(new Map<string, number>())
  /** Children handed to each parent but not yet reported by it. */
  const assignedRef = useRef(new Map<string, number>())
  /** When each parent's reservation was last touched, so stale ones expire. */
  const assignedAtRef = useRef(new Map<string, number>())
  /** Last time anything was heard from a viewer. */
  const lastSeenRef = useRef(new Map<string, number>())
  const parentOfRef = useRef(new Map<string, string>())
  const sweepRef = useRef<number | null>(null)

  const recompute = useCallback(() => {
    let total = callsRef.current.size
    for (const children of relaysRef.current.values()) total += children
    setViewers(total)
  }, [])

  const closeCall = useCallback((id: string) => {
    const call = callsRef.current.get(id)
    if (call) call.close()
    callsRef.current.delete(id)
  }, [])

  const sendStream = useCallback(
    (id: string, stream: MediaStream) => {
      const peer = peerRef.current
      if (!peer) return
      const call = peer.call(id, stream, { metadata: { token: tokenRef.current } })
      callsRef.current.set(id, call)
      call.on('close', () => {
        if (callsRef.current.get(id) !== call) return
        callsRef.current.delete(id)
        recompute()
      })
      recompute()
    },
    [recompute],
  )

  /** Placement candidates, host first; free slots account for pending handoffs. */
  const candidates = useCallback((): Candidate[] => {
    const list: Candidate[] = []
    const host = peerRef.current?.id
    if (host) {
      const assigned = assignedRef.current.get(host) ?? 0
      list.push({ id: host, free: MAX_CHILDREN - Math.max(callsRef.current.size, assigned) })
    }
    for (const [id, children] of relaysRef.current) {
      const assigned = assignedRef.current.get(id) ?? 0
      list.push({ id, free: MAX_CHILDREN - Math.max(children, assigned) })
    }
    return list
  }, [])

  /** Give back the slot a viewer held in its parent's budget. */
  const releaseSlot = useCallback((id: string) => {
    const parent = parentOfRef.current.get(id)
    if (!parent) return
    assignedRef.current.set(parent, Math.max(0, (assignedRef.current.get(parent) ?? 1) - 1))
    assignedAtRef.current.set(parent, Date.now())
    parentOfRef.current.delete(id)
  }, [])

  const dropViewer = useCallback(
    (id: string) => {
      releaseSlot(id)
      connsRef.current.delete(id)
      relaysRef.current.delete(id)
      lastSeenRef.current.delete(id)
      closeCall(id)
      recompute()
    },
    [closeCall, recompute, releaseSlot],
  )

  /**
   * Prune viewers that are gone: either their transport has failed or gone
   * quiet, or nothing has been heard from them for a long while. Without this a
   * viewer whose tab vanishes keeps its slot (and its count) forever, and the
   * host stops placing new viewers.
   */
  const sweep = useCallback(() => {
    const now = Date.now()
    // Reservations only ever reserve capacity for a handoff that is in flight;
    // once they age out the reported child count becomes authoritative again.
    for (const [parent, at] of [...assignedAtRef.current]) {
      if (isReservationStale(at, now)) {
        assignedRef.current.delete(parent)
        assignedAtRef.current.delete(parent)
      }
    }
    for (const [id, conn] of [...connsRef.current]) {
      if (isViewerGone(conn.peerConnection?.connectionState, lastSeenRef.current.get(id), now)) {
        dropViewer(id)
      }
    }
  }, [dropViewer])

  const stop = useCallback(() => {
    if (sweepRef.current !== null) {
      window.clearInterval(sweepRef.current)
      sweepRef.current = null
    }
    for (const call of callsRef.current.values()) call.close()
    callsRef.current.clear()
    for (const conn of connsRef.current.values()) conn.close()
    connsRef.current.clear()
    relaysRef.current.clear()
    assignedRef.current.clear()
    assignedAtRef.current.clear()
    lastSeenRef.current.clear()
    parentOfRef.current.clear()
    peerRef.current?.destroy()
    peerRef.current = null
    tokenRef.current = null
    liveRef.current = false
    setLink(null)
    setViewers(0)
    setStatus('idle')
    setNotice(null)
  }, [])

  // Never leave a peer or its calls alive past unmount.
  useEffect(
    () => () => {
      if (sweepRef.current !== null) window.clearInterval(sweepRef.current)
      sweepRef.current = null
      for (const call of callsRef.current.values()) call.close()
      callsRef.current.clear()
      for (const conn of connsRef.current.values()) conn.close()
      connsRef.current.clear()
      peerRef.current?.destroy()
      peerRef.current = null
    },
    [],
  )

  const start = useCallback(() => {
    if (peerRef.current) return
    setStatus('opening')
    setNotice(null)

    const token = createToken()
    tokenRef.current = token
    const peer = new Peer(peerOptions())
    peerRef.current = peer

    peer.on('open', (id) => {
      liveRef.current = true
      setLink(buildViewerLink(window.location.href, { hostId: id, token }))
      setStatus('live')
      if (sweepRef.current === null) {
        sweepRef.current = window.setInterval(sweep, SWEEP_MS)
      }
    })

    peer.on('error', (error) => {
      liveRef.current = false
      setStatus('error')
      setNotice(`Viewer broadcast unavailable (${error.type}).`)
    })

    peer.on('connection', (conn) => {
      conn.on('data', (raw) => {
        const message = parseBroadcastMessage(raw)
        if (!message || !liveRef.current) return
        lastSeenRef.current.set(conn.peer, Date.now())

        if (message.t === 'join') {
          // Wrong token: drop the connection without a place in the tree.
          if (message.token !== tokenRef.current) {
            conn.close()
            return
          }
          connsRef.current.set(conn.peer, conn)
          // A viewer that rejoins after its parent vanished must not keep the
          // slot it held there, or the tree slowly fills up with ghosts.
          releaseSlot(conn.peer)
          const parentId = chooseParent(candidates())
          if (!parentId) {
            // Every node is saturated: tell the viewer to retry rather than
            // leaving it waiting on a stream that will never come.
            conn.send({ t: 'full' } satisfies BroadcastMessage)
            return
          }
          assignedRef.current.set(parentId, (assignedRef.current.get(parentId) ?? 0) + 1)
          assignedAtRef.current.set(parentId, Date.now())
          parentOfRef.current.set(conn.peer, parentId)
          conn.send({ t: 'parent', parentId } satisfies BroadcastMessage)
          return
        }

        if (message.t === 'feed') {
          if (message.token !== tokenRef.current) return
          const stream = streamRef.current
          if (stream) sendStream(conn.peer, stream)
          return
        }

        if (message.t === 'relay') {
          // A node's own count is authoritative once reported, and the report
          // doubles as its heartbeat.
          relaysRef.current.set(conn.peer, message.children)
          assignedRef.current.delete(conn.peer)
          assignedAtRef.current.delete(conn.peer)
          recompute()
        }
      })

      // A viewer that rejoins is represented by a new connection under the same
      // peer id. Only the connection we are currently tracking may drop it — a
      // late close from a superseded one must not kill the live binding.
      conn.on('close', () => {
        if (connsRef.current.get(conn.peer) !== conn) return
        dropViewer(conn.peer)
      })
    })
  }, [candidates, dropViewer, recompute, releaseSlot, sendStream, sweep])

  const setStream = useCallback(
    (next: MediaStream | null) => {
      const previous = streamRef.current
      streamRef.current = next
      if (!next || !liveRef.current || previous === next) return
      // A media connection cannot swap its track mid-call, so re-publish to the
      // direct children; deeper nodes recover through their rejoin path. The ids
      // are snapshotted first so re-adding a key cannot disturb the walk.
      const children = [...callsRef.current.keys()]
      for (const id of children) {
        closeCall(id)
        sendStream(id, next)
      }
    },
    [closeCall, sendStream],
  )

  return { status, notice, link, viewers, start, stop, setStream }
}
