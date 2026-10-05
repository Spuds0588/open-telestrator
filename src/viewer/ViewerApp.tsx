import { useCallback, useEffect, useRef, useState } from 'react'
import Peer, { type DataConnection, type MediaConnection } from 'peerjs'
import {
  HEARTBEAT_MS,
  MAX_REJOIN_ATTEMPTS,
  STALL_TICKS,
  parseBroadcastMessage,
  parseViewerLink,
  type ViewerSession,
} from '../lib/broadcast'
import { peerOptions } from '../lib/peerConfig'

type ViewerStatus = 'ready' | 'connecting' | 'live' | 'ended' | 'full' | 'error'

/**
 * The viewer page.
 *
 * It joins the host's tree over a data channel, gets a parent, receives that
 * parent's live stream and — in turn — calls any viewer the host places under
 * it. Playback is live-only: no seeking, no catch-up, no synchronisation with
 * other viewers.
 *
 * Because a parent can vanish at any moment (its tab closed, its network dropped,
 * its own parent gone), every viewer watches its own picture: if frames stop, or
 * the transport to its parent dies, it drops its children and rejoins the tree
 * through the host, which is what keeps one failure from freezing a whole branch.
 */
export default function ViewerApp() {
  const [session] = useState<ViewerSession | null>(() => parseViewerLink(window.location.href))
  const [status, setStatus] = useState<ViewerStatus>('ready')
  const [notice, setNotice] = useState<string | null>(
    session ? null : 'This viewer link is incomplete. Ask the host for a fresh one.',
  )
  const [stream, setStream] = useState<MediaStream | null>(null)
  const [muted, setMuted] = useState(true)
  const [parentId, setParentId] = useState<string | null>(null)
  const [children, setChildren] = useState(0)
  const [peerId, setPeerId] = useState<string | null>(null)

  const videoRef = useRef<HTMLVideoElement>(null)
  const peerRef = useRef<Peer | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const hostConnRef = useRef<DataConnection | null>(null)
  const upstreamRef = useRef<MediaConnection | null>(null)
  const childCallsRef = useRef(new Map<string, MediaConnection>())
  const retryTimerRef = useRef<number | null>(null)
  const heartbeatRef = useRef<number | null>(null)
  const joinHostRef = useRef<(() => void) | null>(null)
  const attemptsRef = useRef(0)

  const clearTimers = useCallback(() => {
    if (retryTimerRef.current !== null) {
      window.clearTimeout(retryTimerRef.current)
      retryTimerRef.current = null
    }
    if (heartbeatRef.current !== null) {
      window.clearInterval(heartbeatRef.current)
      heartbeatRef.current = null
    }
  }, [])

  const teardown = useCallback(() => {
    clearTimers()
    for (const child of childCallsRef.current.values()) child.close()
    childCallsRef.current.clear()
    upstreamRef.current?.close()
    upstreamRef.current = null
    hostConnRef.current?.close()
    hostConnRef.current = null
    peerRef.current?.destroy()
    peerRef.current = null
    streamRef.current = null
    attemptsRef.current = 0
    setStream(null)
    setParentId(null)
    setChildren(0)
    setPeerId(null)
  }, [clearTimers])

  useEffect(() => () => teardown(), [teardown])

  // Bind the received stream to the video element.
  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    video.srcObject = stream
    if (stream) void video.play().catch(() => undefined)
    return () => {
      video.srcObject = null
    }
  }, [stream])

  /**
   * Ask the host for a new place in the tree, keeping our peer alive so our id
   * stays stable. Our own children are released first: a media connection cannot
   * hand them a new stream, so they rejoin and heal themselves.
   */
  const rejoin = useCallback(() => {
    const peer = peerRef.current
    if (!peer) return

    for (const child of childCallsRef.current.values()) child.close()
    childCallsRef.current.clear()
    setChildren(0)

    upstreamRef.current?.close()
    upstreamRef.current = null
    streamRef.current = null
    setStream(null)

    // Detach before closing so the close handler sees itself as superseded and
    // does not report the broadcast as ended on the way out.
    const hostConn = hostConnRef.current
    hostConnRef.current = null
    hostConn?.close()

    attemptsRef.current += 1
    if (attemptsRef.current > MAX_REJOIN_ATTEMPTS) {
      clearTimers()
      setStatus('ended')
      setNotice('Lost the broadcast. Ask the host for a fresh link.')
      return
    }

    setStatus('connecting')
    setNotice('Reconnecting…')
    // Back off a little, so a host that is itself restarting is not hammered.
    const delay = Math.min(4000, 400 * 2 ** (attemptsRef.current - 1))
    retryTimerRef.current = window.setTimeout(() => {
      retryTimerRef.current = null
      joinHostRef.current?.()
    }, delay)
  }, [clearTimers])

  const connect = useCallback(() => {
    if (!session || peerRef.current) return
    setStatus('connecting')
    setNotice(null)

    const peer = new Peer(peerOptions())
    peerRef.current = peer

    const report = () => {
      const hostConn = hostConnRef.current
      if (hostConn?.open) hostConn.send({ t: 'relay', children: childCallsRef.current.size })
    }

    const joinHost = () => {
      if (peerRef.current !== peer) return
      const conn = peer.connect(session.hostId, { reliable: true })
      hostConnRef.current = conn
      conn.on('open', () => {
        conn.send({ t: 'join', token: session.token })
        // The heartbeat keeps the host's view of the tree fresh and tells it we
        // are still alive, even while we have no children of our own.
        if (heartbeatRef.current === null) {
          heartbeatRef.current = window.setInterval(report, HEARTBEAT_MS)
        }
      })
      conn.on('data', (raw) => {
        const message = parseBroadcastMessage(raw)
        if (!message) return
        if (message.t === 'full') {
          setStatus('full')
          setNotice('The broadcast is full right now — try again in a moment.')
          return
        }
        if (message.t !== 'parent') return
        setParentId(message.parentId)
        if (message.parentId === session.hostId) {
          conn.send({ t: 'feed', token: session.token })
          return
        }
        const upstream = peer.connect(message.parentId, { reliable: true })
        upstream.on('open', () => upstream.send({ t: 'feed', token: session.token }))
      })
      conn.on('close', () => {
        if (hostConnRef.current !== conn) return
        hostConnRef.current = null
        if (streamRef.current) return
        clearTimers()
        setStatus('ended')
        setNotice('The broadcast ended. Ask the host for a fresh link.')
      })
    }
    joinHostRef.current = joinHost

    peer.on('open', (id) => {
      setPeerId(id)
      joinHost()
    })

    peer.on('error', (error) => {
      // The host peer is gone: the broadcast is over, not broken. Any other
      // error is a genuine failure to reach the broker.
      if (error.type === 'peer-unavailable') {
        clearTimers()
        setStatus('ended')
        setNotice('The broadcast ended. Ask the host for a fresh link.')
        return
      }
      setStatus('error')
      setNotice(`Could not join the broadcast (${error.type}).`)
    })

    // Our parent calls us with the live stream: answer without sending anything
    // back, then relay whatever arrives.
    peer.on('call', (call) => {
      call.answer()
      upstreamRef.current?.close()
      upstreamRef.current = call
      call.on('stream', (remote) => {
        streamRef.current = remote
        setStream(remote)
        setStatus('live')
        setNotice(null)
        // Note: the attempt counter is only reset once frames actually decode.
        // A parent that delivers a track but no picture must not be allowed to
        // reset it, or a frozen source loops through reconnects forever.
        report()
      })
      call.on('close', () => {
        if (upstreamRef.current === call) upstreamRef.current = null
        if (peerRef.current === peer && streamRef.current) {
          setNotice('Your feed stopped — finding a new source…')
          rejoin()
        } else if (peerRef.current === peer) {
          // A parent that never delivered: ask the host to place us elsewhere.
          rejoin()
        }
      })
    })

    // Downstream viewers ask us for the stream over a data channel; we call
    // them with the stream we are relaying, which is what makes this a tree.
    peer.on('connection', (conn) => {
      conn.on('data', (raw) => {
        const message = parseBroadcastMessage(raw)
        if (!message || message.t !== 'feed' || message.token !== session.token) return
        const media = streamRef.current
        if (!media) return
        const child = peer.call(conn.peer, media, { metadata: { token: session.token } })
        childCallsRef.current.set(conn.peer, child)
        setChildren(childCallsRef.current.size)
        report()
        child.on('close', () => {
          if (childCallsRef.current.get(conn.peer) !== child) return
          childCallsRef.current.delete(conn.peer)
          setChildren(childCallsRef.current.size)
          report()
        })
      })
      conn.on('close', () => {
        childCallsRef.current.get(conn.peer)?.close()
        childCallsRef.current.delete(conn.peer)
        setChildren(childCallsRef.current.size)
        report()
      })
    })
  }, [clearTimers, rejoin, session])

  /**
   * Watch our own picture. Two independent signals mean "my parent is gone":
   * the transport to it failing, and the decoder going quiet. Either one drops
   * this node — and its children — back into the tree through the host.
   */
  useEffect(() => {
    if (status !== 'live') return
    const video = videoRef.current
    if (!video) return

    const decodedFrames = (): number | null => {
      const withQuality = video as HTMLVideoElement & {
        getVideoPlaybackQuality?: () => { totalVideoFrames: number }
      }
      return withQuality.getVideoPlaybackQuality
        ? withQuality.getVideoPlaybackQuality().totalVideoFrames
        : null
    }

    let previous = decodedFrames()
    let stalled = 0
    const timer = window.setInterval(() => {
      const transport = upstreamRef.current?.peerConnection?.connectionState
      if (transport === 'failed' || transport === 'closed') {
        rejoin()
        return
      }
      const frames = decodedFrames()
      if (frames === null) return
      if (previous !== null && frames > previous) {
        // A moving picture is the only proof the path is healthy.
        stalled = 0
        attemptsRef.current = 0
        previous = frames
        return
      }
      previous = frames
      stalled += 1
      if (stalled >= STALL_TICKS) {
        stalled = 0
        rejoin()
      }
    }, 1000)

    return () => window.clearInterval(timer)
  }, [status, rejoin])

  const retry = useCallback(() => {
    teardown()
    setStatus('ready')
    setNotice(null)
    connect()
  }, [teardown, connect])

  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined)
    else void document.documentElement.requestFullscreen().catch(() => undefined)
  }, [])

  const statusText =
    status === 'ready'
      ? 'Tap Watch to join the live broadcast.'
      : status === 'connecting'
        ? 'Connecting to the broadcast…'
        : status === 'live'
          ? children > 0
            ? `Live — also relaying to ${children} viewer${children === 1 ? '' : 's'}.`
            : 'Live — you are watching the host’s program.'
          : status === 'full'
            ? 'The broadcast is full.'
            : status === 'ended'
              ? 'The broadcast ended.'
              : 'Something went wrong.'

  return (
    <div
      className="viewer"
      data-testid="viewer"
      data-status={status}
      data-parent={parentId ?? ''}
      data-children={children}
      data-peer={peerId ?? ''}
    >
      <div className="viewer__stage">
        <video ref={videoRef} className="viewer__video" muted={muted} playsInline />
        {!stream && (
          <div className="screen__empty">
            {status === 'ready' ? 'Not connected' : 'No signal yet'}
          </div>
        )}
      </div>

      <div className="viewer__bar">
        {status === 'ready' && (
          <button type="button" className="btn" data-testid="viewer-start" onClick={connect}>
            ▶ Watch
          </button>
        )}
        {status === 'live' && (
          <button type="button" className="btn" data-testid="viewer-audio" onClick={() => setMuted((m) => !m)}>
            {muted ? '🔇 Unmute' : '🔊 Mute'}
          </button>
        )}
        {(status === 'ended' || status === 'full' || status === 'error') && (
          <button type="button" className="btn" data-testid="viewer-retry" onClick={retry}>
            Try again
          </button>
        )}

        <span className="viewer__status" data-testid="viewer-status" data-state={status} role="status">
          {statusText}
        </span>

        {status === 'live' && (
          <button type="button" className="chip" data-testid="viewer-fullscreen" onClick={toggleFullscreen}>
            ⛶ Full screen
          </button>
        )}
      </div>

      {notice && (
        <p className="viewer__notice" role="alert">
          {notice}
        </p>
      )}
    </div>
  )
}
