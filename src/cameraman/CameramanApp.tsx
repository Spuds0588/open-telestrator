import { useCallback, useEffect, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import Peer, { type DataConnection, type MediaConnection } from 'peerjs'
import { parseCameraLink, parseCameraReport, type CameraSession } from '../lib/cameraLink'
import { applyCollabOp, drawOp, parseCollabOp, type CollabOp } from '../lib/collab'
import { classifyCameraError } from '../lib/mediaErrors'
import { peerOptions } from '../lib/peerConfig'
import { TelestrationOverlay } from '../components/TelestrationOverlay'
import {
  ALL_TOOLS,
  COLORS,
  DEFAULT_COLOR,
  DEFAULT_TOOL,
  DEFAULT_WIDTH,
  toolGlyph,
  type Stroke,
  type Tool,
} from '../lib/telestration'

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
 * The lightweight co-host page — the cameraman page, and the shared canvas.
 *
 * It connects to the host peer from the magic link. Sharing the phone's camera
 * is optional: with it, a single one-way media call sends only the camera and
 * the host answers with no stream. Either way the host calls back with the
 * program picture and both directions trade drawing operations over the same
 * token-checked data channel, so a second person can telestrate on the host's
 * canvas without ever granting camera access.
 */
export default function CameramanApp() {
  const [session] = useState<CameraSession | null>(() => parseCameraLink(window.location.href))
  const [status, setStatus] = useState<CameramanStatus>('ready')
  const [notice, setNotice] = useState<string | null>(
    session ? null : 'This camera link is incomplete. Ask the host for a fresh link.',
  )
  const [preview, setPreview] = useState<MediaStream | null>(null)
  /** How many people are watching, as last reported by the host. */
  const [viewers, setViewers] = useState<number | null>(null)
  /** The program picture the host sends so we have something to draw on. */
  const [program, setProgram] = useState<MediaStream | null>(null)
  /** Whether the drawing surface is open over the camera preview. */
  const [drawing, setDrawing] = useState(false)

  // Drawing state, mirroring the host's: the same stack, the same gestures.
  const [tool, setTool] = useState<Tool>(DEFAULT_TOOL)
  const [color, setColor] = useState<string>(DEFAULT_COLOR)
  const width = DEFAULT_WIDTH
  const [strokes, setStrokes] = useState<Stroke[]>([])

  const videoRef = useRef<HTMLVideoElement>(null)
  const programVideoRef = useRef<HTMLVideoElement>(null)
  const peerRef = useRef<Peer | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const callRef = useRef<MediaConnection | null>(null)
  /** The host's program call, answered with no stream in return. */
  const programCallRef = useRef<MediaConnection | null>(null)
  const channelRef = useRef<DataConnection | null>(null)
  const timerRef = useRef<number | null>(null)
  /** Guards against a second join while the first is still connecting. */
  const joiningRef = useRef(false)

  const teardown = useCallback(() => {
    joiningRef.current = false
    if (timerRef.current !== null) {
      window.clearInterval(timerRef.current)
      timerRef.current = null
    }
    callRef.current?.close()
    callRef.current = null
    programCallRef.current?.close()
    programCallRef.current = null
    channelRef.current?.close()
    channelRef.current = null
    peerRef.current?.destroy()
    peerRef.current = null
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
    setPreview(null)
    setViewers(null)
    setProgram(null)
    setStrokes([])
    setDrawing(false)
  }, [])

  useEffect(() => () => teardown(), [teardown])

  // The drawing surface only exists while the host is offering the program.
  useEffect(() => {
    if (!program) setDrawing(false)
  }, [program])

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

  // Bind the program picture; `drawing` re-runs it when the element mounts.
  useEffect(() => {
    const video = programVideoRef.current
    if (!video) return
    video.srcObject = program
    if (program) void video.play().catch(() => undefined)
    return () => {
      video.srcObject = null
    }
  }, [program, drawing])

  /** Send a drawing operation to the host, which owns the stroke stack. */
  const sendOp = useCallback((op: CollabOp) => {
    const channel = channelRef.current
    if (channel?.open) channel.send(op)
  }, [])

  const commitStroke = useCallback(
    (stroke: Stroke) => {
      setStrokes((prev) => applyCollabOp(prev, drawOp(stroke)))
      sendOp(drawOp(stroke))
    },
    [sendOp],
  )

  const handleUndo = useCallback(() => {
    if (strokes.length === 0) return
    const last = strokes[strokes.length - 1]
    setStrokes(strokes.slice(0, -1))
    sendOp({ t: 'remove', id: last.id })
  }, [strokes, sendOp])

  const handleClear = useCallback(() => {
    setStrokes([])
    sendOp({ t: 'clear' })
  }, [sendOp])

  /**
   * Join the host. With a camera the media call leads and the channel follows;
   * without one the channel alone makes the connection, so a co-host who is
   * only there to draw never has to grant camera permission.
   */
  const connect = useCallback(async (wantCamera: boolean) => {
    if (!session || joiningRef.current || peerRef.current) return
    joiningRef.current = true
    setNotice(null)

    let media: MediaStream | null = null
    if (wantCamera) {
      setStatus('requesting')
      try {
        if (!navigator.mediaDevices?.getUserMedia) {
          throw new DOMException('getUserMedia is unavailable', 'NotSupportedError')
        }
        media = await navigator.mediaDevices.getUserMedia(CAMERA_CONSTRAINTS)
      } catch (cause) {
        const { status: next, notice: text } = classifyCameraError(cause)
        setStatus(next)
        setNotice(text)
        joiningRef.current = false
        return
      }
      streamRef.current = media
      setPreview(media)
    }

    setStatus('connecting')

    const peer = new Peer(peerOptions())
    peerRef.current = peer

    // The host calls back with the program picture. Only the host we dialled may
    // do so; answering sends no media the other way — the camera path stays
    // one-way.
    peer.on('call', (call) => {
      if (call.peer !== session.hostId) {
        call.close()
        return
      }
      call.answer()
      programCallRef.current = call
      call.on('stream', (remote) => setProgram(remote))
      call.on('close', () => {
        setProgram(null)
        if (programCallRef.current === call) programCallRef.current = null
      })
    })

    peer.on('error', (error) => {
      joiningRef.current = false
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
      const call = media
        ? peer.call(session.hostId, media, { metadata: { token: session.token } })
        : null
      callRef.current = call

      // The data channel carries the viewer count down and drawing operations
      // both ways: the host repeats the count so we can show how many people are
      // watching, and echoes the shared strokes so both canvases agree.
      const channel = peer.connect(session.hostId, {
        reliable: true,
        metadata: { token: session.token },
      })
      channelRef.current = channel
      let opened = false
      channel.on('open', () => {
        opened = true
        // With no camera call to wait on, the channel is the whole connection.
        if (!call) setStatus('live')
      })
      channel.on('data', (raw) => {
        const report = parseCameraReport(raw)
        if (report) {
          setViewers(report.count)
          return
        }
        const op = parseCollabOp(raw)
        if (op) setStrokes((prev) => applyCollabOp(prev, op))
      })
      // No channel, no picture: drop the count rather than leave a number that
      // may no longer be true sitting next to a dead camera.
      channel.on('close', () => {
        setViewers(null)
        if (channelRef.current !== channel) return
        channelRef.current = null
        // Closed before it ever opened: the host refused the token.
        if (!opened) {
          setStatus('rejected')
          setNotice((prev) => prev ?? 'The host did not accept this invite. Ask for a fresh link.')
        } else if (!call) {
          setStatus('error')
          setNotice('The host ended the co-host session.')
        }
      })

      // No camera: the channel is the only connection, so there is nothing to
      // watch for a negotiated media path.
      if (!call) return

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
          <h1>Co-host</h1>
        </div>
        {viewers !== null && (
          <span className="camera__viewers" data-testid="camera-viewers">
            <span aria-hidden="true">👁</span>{' '}
            {viewers === 1 ? '1 viewer' : `${viewers} viewers`}
          </span>
        )}
      </header>

      <main className="camera__main">
        {drawing && program ? (
          /* The shared canvas: the program picture with the co-host's strokes. */
          <div className="camera__draw" data-testid="camera-draw">
            <div className="camera__draw-tools">
              {ALL_TOOLS.map((entry) => (
                <button
                  key={entry}
                  type="button"
                  className={'btn btn--ghost' + (entry === tool ? ' is-active' : '')}
                  data-testid={`camera-tool-${entry}`}
                  aria-label={entry}
                  aria-pressed={entry === tool}
                  onClick={() => setTool(entry)}
                >
                  {toolGlyph(entry)}
                </button>
              ))}
              <span className="camera__swatches">
                {COLORS.map((swatch) => (
                  <button
                    key={swatch}
                    type="button"
                    className={'camera__swatch' + (swatch === color ? ' is-active' : '')}
                    style={{ background: swatch } as CSSProperties}
                    data-testid={`camera-colour-${swatch}`}
                    aria-label={`Colour ${swatch}`}
                    aria-pressed={swatch === color}
                    onClick={() => setColor(swatch)}
                  />
                ))}
              </span>
              <button
                type="button"
                className="btn btn--ghost"
                data-testid="camera-undo"
                disabled={strokes.length === 0}
                onClick={handleUndo}
              >
                Undo
              </button>
              <button
                type="button"
                className="btn btn--ghost"
                data-testid="camera-clear"
                disabled={strokes.length === 0}
                onClick={handleClear}
              >
                Clear
              </button>
              <button
                type="button"
                className="btn"
                data-testid="camera-draw-close"
                onClick={() => setDrawing(false)}
              >
                Done
              </button>
            </div>
            <div className="camera__preview" data-testid="camera-draw-preview">
              <video ref={programVideoRef} className="camera__video" muted playsInline />
              <TelestrationOverlay
                strokes={strokes}
                tool={tool}
                color={color}
                width={width}
                onStrokeCommitted={commitStroke}
              />
            </div>
          </div>
        ) : (
          <>
            <div
              className={"camera__preview" + (fullscreen ? ' camera__preview--fullscreen' : '')}
              data-testid="camera-preview"
            >
              <video
                ref={videoRef}
                className={"camera__video" + (zoom > 1 ? ' camera__video--zoomed' : '')}
                style={zoom > 1 ? ({ '--zoom': zoom.toString() } as CSSProperties) : undefined}
                muted
                playsInline
              />
              {!preview && <div className="screen__empty">No camera</div>}
            </div>

            <p className="camera__status" data-testid="camera-status" data-state={status} role="status">
              {status === 'ready' && 'Tap to start your camera and join the broadcast.'}
              {status === 'requesting' && 'Waiting for camera permission…'}
              {status === 'connecting' && 'Connecting to the host…'}
              {status === 'live' &&
            (preview
              ? 'Live — your camera is streaming to the host.'
              : 'Connected — you can draw on the program.')}
              {status === 'denied' && 'Camera permission was blocked.'}
              {status === 'rejected' && 'The host did not accept this camera.'}
              {status === 'error' && 'Something went wrong.'}
            </p>
            {notice && (
              <p className="camera__notice" role="alert">
                {notice}
              </p>
            )}

            {/* Zoom + full-screen controls, shown on a live camera. */}
            {status === 'live' && preview && (
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

            {/* Co-host controls: only once the host offers the program picture. */}
            {status === 'live' && program && (
              <button
                type="button"
                className="btn"
                data-testid="camera-draw-open"
                onClick={() => setDrawing(true)}
              >
                ✎ Draw on the program
              </button>
            )}

            {status === 'ready' || status === 'rejected' || status === 'error' || status === 'denied' ? (
              <div className="camera__zoom-btns">
                <button
                  type="button"
                  className="btn"
                  data-testid="camera-start"
                  disabled={!session}
                  onClick={() => void (status === 'ready' ? connect(true) : retry())}
                >
                  {status === 'ready' ? 'Start camera' : 'Try again'}
                </button>
                {status === 'ready' && (
                  <button
                    type="button"
                    className="btn btn--ghost"
                    data-testid="camera-join"
                    disabled={!session}
                    onClick={() => void connect(false)}
                  >
                    Join without a camera
                  </button>
                )}
              </div>
            ) : (
              <button type="button" className="btn btn--ghost" data-testid="camera-stop" onClick={retry}>
                Stop
              </button>
            )}
          </>
        )}
      </main>
    </div>
  )
}
