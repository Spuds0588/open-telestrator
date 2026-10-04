import { useCallback, useEffect, useRef, useState } from 'react'
import Peer, { type MediaConnection } from 'peerjs'
import { buildCameraLink, createToken } from './cameraLink'
import { peerOptions } from './peerConfig'

/** A remote camera feed that has connected and is streaming to this host. */
export interface CameraSource {
  /** The cameraman's PeerJS id — stable for the life of its call. */
  id: string
  label: string
  stream: MediaStream
}

export type HostCameraStatus = 'idle' | 'opening' | 'ready' | 'error'

export interface HostCamera {
  status: HostCameraStatus
  notice: string | null
  /** The magic link to hand to a cameraman, once the peer is open. */
  link: string | null
  /** Every camera currently streaming in, newest last. */
  sources: CameraSource[]
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
 * an answer. `answer()` is called with **no stream**, so the host sends no media
 * back and nothing from the stage can leak to the cameraman — the transport is
 * strictly one-way.
 */
export function useHostCamera(): HostCamera {
  const [status, setStatus] = useState<HostCameraStatus>('idle')
  const [notice, setNotice] = useState<string | null>(null)
  const [link, setLink] = useState<string | null>(null)
  const [sources, setSources] = useState<CameraSource[]>([])

  const peerRef = useRef<Peer | null>(null)
  const tokenRef = useRef<string | null>(null)
  const callsRef = useRef(new Map<string, MediaConnection>())

  const closeAll = useCallback(() => {
    for (const call of callsRef.current.values()) call.close()
    callsRef.current.clear()
    peerRef.current?.destroy()
    peerRef.current = null
    tokenRef.current = null
    setSources([])
    setLink(null)
  }, [])

  const stop = useCallback(() => {
    closeAll()
    setStatus('idle')
    setNotice(null)
  }, [closeAll])

  // Never leave a peer or its calls alive past unmount.
  useEffect(
    () => () => {
      for (const call of callsRef.current.values()) call.close()
      callsRef.current.clear()
      peerRef.current?.destroy()
      peerRef.current = null
    },
    [],
  )

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
      setLink(buildCameraLink(window.location.href, { hostId: id, token }))
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

      // Answer with no stream — the host never sends media back.
      call.answer()

      const id = call.peer
      call.on('stream', (remote) => {
        setSources((prev) =>
          prev.some((source) => source.id === id)
            ? prev
            : [...prev, { id, label: `Camera ${id.slice(0, 4)}`, stream: remote }],
        )
      })
      call.on('close', () => {
        callsRef.current.delete(id)
        setSources((prev) => prev.filter((source) => source.id !== id))
      })
      callsRef.current.set(id, call)
    })
  }, [])

  return { status, notice, link, sources, createLink, stop }
}
