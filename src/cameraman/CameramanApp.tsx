import { useCallback, useEffect, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import Peer, { type MediaConnection } from 'peerjs'
import { parseCameraLink, type CameraSession } from '../lib/cameraLink'
import { classifyCameraError } from '../lib/mediaErrors'
import { peerOptions } from '../lib/peerConfig'

type CameramanStatus =
  | 'ready'
  | 'requesting'
  | 'connecting'
  | 'live'
  | 'denied'
  | 'rejected'
  | 'error'

const CAMERA_CONSTRAINTS: MediaStreamConstraints = {
  // Rear camera by preference; browsers fall back to whatever is available.
  video: { facingMode: 'environment' },
  audio: false,
}

/**
 * How long to wait for the host to accept. A rejected token is answered with a
 * close rather than an error, which PeerJS does not always surface promptly, so
 * this bound keeps a rejected cameraman from hanging on "connecting" forever.
 */
const ACCEPT_TIMEOUT_MS = 12000

/**
 * The lightweight cameraman page.
 *
 * It opens the phone's camera, connects to the host peer from the magic link,
 * and makes a single one-way media call. Only the camera is sent — the host
 * answers without a stream — so this view is deliberately tiny: preview,
 * status, one button.
 */
export default function CameramanApp() {
  const [session] = useState<CameraSession | null>(() => parseCameraLink(window.location.href))
  const [status, setStatus] = useState<CameramanStatus>('ready')
  const [notice, setNotice] = useState<string | null>(
    session ? null : 'This camera link is incomplete. Ask the host for a fresh link.',
  )
  const [preview, setPreview] = useState<MediaStream | null>(null)

  const videoRef = useRef<HTMLVideoElement>(null)
  const peerRef = useRef<Peer | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const callRef = useRef<MediaConnection | null>(null)
  const timerRef = useRef<number | null>(null)

  const teardown = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearInterval(timerRef.current)
      timerRef.current = null
    }
    callRef.current?.close()
    callRef.current = null
    peerRef.current?.destroy()
    peerRef.current = null
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
    setPreview(null)
  }, [])

  useEffect(() => () => teardown(), [teardown])

  // Bind the local preview once the camera is open.
  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    video.srcObject = preview
    if (preview) void video.play().catch(() => undefined)
    return () => {
      video.srcObject = null
    }
  }, [preview])

  const start = useCallback(async () => {
    if (!session || streamRef.current) return
    setStatus('requesting')
    setNotice(null)

    let media: MediaStream
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new DOMException('getUserMedia is unavailable', 'NotSupportedError')
      }
      media = await navigator.mediaDevices.getUserMedia(CAMERA_CONSTRAINTS)
    } catch (cause) {
      const { status: next, notice: text } = classifyCameraError(cause)
      setStatus(next)
      setNotice(text)
      return
    }

    streamRef.current = media
    setPreview(media)
    setStatus('connecting')

    const peer = new Peer(peerOptions())
    peerRef.current = peer

    peer.on('error', (error) => {
      setStatus('error')
      setNotice(
        error.type === 'peer-unavailable'
          ? 'The host is offline. Ask them for a fresh link.'
          : `Could not connect to the host (${error.type}).`,
      )
    })

    peer.on('open', () => {
      // One-way: we send our camera and expect no stream back. The token rides
      // in the call metadata; the host closes the call if it doesn't match.
      const call = peer.call(session.hostId, media, { metadata: { token: session.token } })
      callRef.current = call

      call.on('close', () => {
        // The host rejected the token or hung up: no media was ever established.
        setStatus((prev) => (prev === 'live' ? 'error' : 'rejected'))
        setNotice((prev) => prev ?? 'The host ended or rejected this camera. Ask for a fresh link.')
      })

      // PeerJS exposes the media connection's RTCPeerConnection, so "live" means
      // the two peers actually negotiated and media is flowing.
      const startedAt = Date.now()
      const settle = () => {
        if (timerRef.current !== null) {
          window.clearInterval(timerRef.current)
          timerRef.current = null
        }
      }
      const watch = () => {
        const pc = call.peerConnection
        if (pc && pc.connectionState === 'connected') {
          setStatus('live')
          settle()
        } else if (pc && pc.connectionState === 'failed') {
          setStatus('error')
          setNotice('The connection to the host failed.')
          settle()
        } else if (Date.now() - startedAt > ACCEPT_TIMEOUT_MS) {
          setStatus('rejected')
          setNotice('The host did not accept this camera. Ask for a fresh link.')
          settle()
        }
      }
      timerRef.current = window.setInterval(watch, 300)
      watch()
    })
  }, [session])

  const retry = useCallback(() => {
    teardown()
    setStatus('ready')
    setNotice(null)
  }, [teardown])

  // Digital zoom state: a CSS transform scale applied to the video element.
  const [zoom, setZoom] = useState(1)
  const zoomIn = useCallback(() => setZoom((v) => Math.min(4, v + 0.25)), [])
  const zoomOut = useCallback(() => setZoom((v) => Math.max(1, v - 0.25)), [])
  const resetZoom = useCallback(() => setZoom(1), [])

  // Toggle the full-screen mode. The video keeps aspect ratio via
  // `object-fit: contain` and the container resizes to fill the viewport.
  const [fullscreen, setFullscreen] = useState(false)
  const enterFullscreen = useCallback(() => {
    if (document.fullscreenElement) return
    const el = document.documentElement
    void el.requestFullscreen().catch(() => undefined)
    setFullscreen(true)
  }, [])
  const exitFullscreen = useCallback(() => {
    if (document.fullscreenElement) {
      void document.exitFullscreen().catch(() => undefined)
    }
    setFullscreen(false)
  }, [])
  useEffect(() => {
    if (!fullscreen) return
    const onFullscreenChange = () => {
      if (!document.fullscreenElement) setFullscreen(false)
    }
    document.addEventListener('fullscreenchange', onFullscreenChange)
    return () => document.removeEventListener('fullscreenchange', onFullscreenChange)
  }, [fullscreen])

  return (
    <div className="camera">
      <header className="camera__topbar">
        <div className="brand">
          <span className="brand__dot" aria-hidden="true" />
          <h1>Cameraman</h1>
        </div>
      </header>

      <main className="camera__main">
        <div
          className={"camera__preview" + (fullscreen ? ' camera__preview--fullscreen' : '')}
          data-testid="camera-preview"
        >
          <video
            ref={videoRef}
            className="camera__video"
            style={zoom > 1 ? { '--zoom': zoom.toString() } as CSSProperties : undefined}
            muted
            playsInline
          />
          {!preview && <div className="screen__empty">No camera</div>}
        </div>

        <p className="camera__status" data-testid="camera-status" data-state={status} role="status">
          {status === 'ready' && 'Tap to start your camera and join the broadcast.'}
          {status === 'requesting' && 'Waiting for camera permission…'}
          {status === 'connecting' && 'Connecting to the host…'}
          {status === 'live' && 'Live — your camera is streaming to the host.'}
          {status === 'denied' && 'Camera permission was blocked.'}
          {status === 'rejected' && 'The host did not accept this camera.'}
          {status === 'error' && 'Something went wrong.'}
        </p>
        {notice && (
          <p className="camera__notice" role="alert">
            {notice}
          </p>
        )}

        {/* Zoom + full-screen controls, shown on live camera. */}
        {status === 'live' && (
          <div className="camera__zoom-btns">
            <button
              type="button"
              className="btn"
              data-testid="camera-zoom-out"
              onClick={zoomOut}
              aria-label="Zoom out"
            >
              −
            </button>
            <button
              type="button"
              className="btn"
              data-testid="camera-zoom-reset"
              onClick={resetZoom}
              aria-label="Reset zoom"
            >
              100%
            </button>
            <button
              type="button"
              className="btn"
              data-testid="camera-zoom-in"
              onClick={zoomIn}
              aria-label="Zoom in"
            >
              +
            </button>
            <button
              type="button"
              className="btn btn--ghost"
              data-testid="camera-fullscreen"
              onClick={fullscreen ? exitFullscreen : enterFullscreen}
              aria-label={fullscreen ? 'Exit full screen' : 'Enter full screen'}
            >
              {fullscreen ? '⛶ Exit' : '⛶ Full'}
            </button>
          </div>
        )}

        {status === 'ready' || status === 'rejected' || status === 'error' || status === 'denied' ? (
          <button
            type="button"
            className="btn"
            data-testid="camera-start"
            disabled={!session}
            onClick={() => void (status === 'ready' ? start() : retry())}
          >
            {status === 'ready' ? 'Start camera' : 'Try again'}
          </button>
        ) : (
          <button type="button" className="btn btn--ghost" data-testid="camera-stop" onClick={retry}>
            Stop
          </button>
        )}
      </main>
    </div>
  )
}
