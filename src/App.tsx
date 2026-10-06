import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useDisplayCapture } from './lib/capture'
import { useHostCamera } from './lib/useHostCamera'
import { useHostCameras } from './lib/useHostCameras'
import { useMediaFeeds } from './lib/useMediaFeeds'
import { useAudioMixer } from './lib/useAudioMixer'
import { useReplay } from './lib/useReplay'
import { COHOST_CAMERA_PREFIX, mergeStageSources } from './lib/sources'
import { useBroadcast } from './lib/useBroadcast'
import { mixBroadcastStream } from './lib/broadcast'
import { useProgramCompositor } from './lib/useProgramCompositor'
import { useQrCode } from './lib/useQrCode'
import { useHardware } from './lib/useHardware'
import type { HardwareAction } from './lib/hardware'
import { applyCollabOp, drawOp, type CollabOp } from './lib/collab'
import {
  COLORS,
  DEFAULT_COLOR,
  DEFAULT_TOOL,
  DEFAULT_WIDTH,
  type Stroke,
  type Tool,
} from './lib/telestration'
import { isDesktop, onControlMode, setControlMode } from './lib/desktop'
import { DEFAULT_MODE, bodyClass, type ControlMode } from './lib/controlMode'
import { useStreamOut } from './lib/useStreamOut'
import { Sidebar } from './components/Sidebar'
import { VideoStage } from './components/VideoStage'

/** Narrow, stable colour handles so the document keydown handler can hand a
 * value to the React `setColor` dispatch without fighting the literal union.
 */
export type Color = typeof COLORS[number]

function nextColor(current: string): string {
  const index = COLORS.indexOf(current as Color)
  return COLORS[(index + 1) % COLORS.length] as string
}

function prevColor(current: string): string {
  const index = COLORS.indexOf(current as Color)
  return COLORS[(index - 1 + COLORS.length) % COLORS.length] as string
}

/** The web app is desktop-only; phones and tablets get a notice instead. */
const GITHUB_URL = 'https://github.com/Spuds0588/open-telestrator'

export default function App() {
  const capture = useDisplayCapture()
  const cameras = useHostCameras()
  const media = useMediaFeeds()
  // The viewer tree comes first: the cameraman session reports its count to the
  // co-hosts, so it needs the number to exist before it is created.
  const broadcast = useBroadcast()

  // Drawing state owned by the host (see Sidebar / TelestrationOverlay). It sits
  // above the camera session because the co-host shares this very stack. The
  // stroke width is fixed in the web MVP; a settings panel can expose it later.
  const [tool, setTool] = useState<Tool>(DEFAULT_TOOL)
  const [color, setColor] = useState<string>(DEFAULT_COLOR)
  const width = DEFAULT_WIDTH
  const [past, setPast] = useState<Stroke[]>([])
  const [future, setFuture] = useState<Stroke[]>([])

  // The desktop shell brings two things a browser cannot: a window that can
  // ignore the pointer, and an RTMP socket. Both are inert on the web.
  const desktop = isDesktop()
  const [mode, setMode] = useState<ControlMode>(DEFAULT_MODE)
  // Whether the program should be composited for stream-out. Kept separate from
  // the stream's own state because the compositor has to be running *before* the
  // publisher connects, or the first seconds of the stream are a blank canvas.
  const [streamOn, setStreamOn] = useState(false)

  /** Change the mode here and, if there is a shell, in the window itself. */
  const changeMode = useCallback((next: ControlMode) => {
    setMode(next)
    if (desktop) void setControlMode(next === 'control')
  }, [desktop])

  // The global shortcut and the tray icon change the mode without us: follow
  // whatever the shell reports rather than assuming ours is authoritative.
  useEffect(() => {
    if (!desktop) return
    let dispose: (() => void) | null = null
    void onControlMode((control) => setMode(control ? 'control' : 'draw')).then((off) => {
      dispose = off
    })
    return () => dispose?.()
  }, [desktop])

  // In Control mode the window is a clear pane over whatever is beneath it, so
  // the chrome steps out of the way — see `body.control` in index.css.
  useEffect(() => {
    document.body.classList.toggle('control', bodyClass(mode) === 'control')
    document.body.classList.toggle('desktop', desktop)
    return () => {
      document.body.classList.remove('control', 'desktop')
    }
  }, [mode, desktop])

  // A co-host's operation lands in the same stack the compositor puts on air.
  const applyRemoteOp = useCallback((op: CollabOp) => {
    setPast((prev) => applyCollabOp(prev, op))
    setFuture([])
  }, [])

  const camera = useHostCamera(broadcast.viewers, { strokes: past, onRemoteOp: applyRemoteOp })

  // The stage's inputs, in program order: the host's shared screen, the host's
  // own cameras, opened video files and streams, then every cameraman currently
  // streaming in. Exactly one of these is the program at a time.
  const sources = useMemo(
    () =>
      mergeStageSources(
        capture.stream,
        cameras.sources,
        media.feeds,
        camera.sources.map((source) => ({
          id: `${COHOST_CAMERA_PREFIX}${source.id}`,
          label: source.label,
          stream: source.stream,
        })),
      ),
    [capture.stream, cameras.sources, media.feeds, camera.sources],
  )

  // Keep the selection valid: default to the first source and fall back when the
  // selected one disappears (capture stopped, feed closed, cameraman hung up).
  const [selectedId, setSelectedId] = useState<string | null>(null)
  useEffect(() => {
    if (selectedId && sources.some((source) => source.id === selectedId)) return
    setSelectedId(sources[0]?.id ?? null)
  }, [sources, selectedId])

  const selected = sources.find((source) => source.id === selectedId) ?? null

  // The element behind an opened file or stream: the mixer takes that feed's
  // audio from the element itself, since its capture is video-only.
  const selectedElement = media.feeds.find((feed) => feed.id === selectedId)?.element ?? null

  // The commentator's corner camera: any source, in the bottom-right of the
  // program. It is dropped when it disappears or becomes the program itself.
  const [cornerId, setCornerId] = useState<string | null>(null)
  const corner = cornerId ? sources.find((source) => source.id === cornerId) ?? null : null
  useEffect(() => {
    if (cornerId && (!corner || cornerId === selectedId)) setCornerId(null)
  }, [cornerId, corner, selectedId])

  // Audio and replay are owned here so their controls can live in the sidebar.
  const audio = useAudioMixer(selected?.stream ?? null, selectedElement)
  const videoRef = useRef<HTMLVideoElement>(null)
  const replay = useReplay(selected?.stream ?? null, videoRef)

  // The stage is the program: the compositor redraws it — video, corners and
  // strokes — into one stream while viewers are being fed.
  const liveRef = useRef<HTMLVideoElement>(null)
  const cornerRef = useRef<HTMLVideoElement>(null)
  const composited = useProgramCompositor({
    // Viewers are fed from the composite, and so is stream-out; either one is a
    // reason to be drawing it.
    active: broadcast.status === 'live' || streamOn,
    videoRef,
    liveRef,
    cornerRef,
    strokes: past,
    replaying: replay.replaying,
  })

  // The picture a co-host draws on is the raw program source, not the composite:
  // the co-host paints the shared strokes onto its own canvas, so sending the
  // composite (which already has them burned in) would draw every stroke twice.
  // Both sides letterbox the same source into a 16:9 frame, so a stroke lands in
  // the same place on each. Publishing it opens a media call to every co-host.
  const cohostProgram = selected?.stream ?? null
  const { publishProgram, sendOp } = camera
  useEffect(() => {
    publishProgram(cohostProgram)
  }, [publishProgram, cohostProgram])

  // The host publishes the composited picture plus the stage audio mix.
  const { status: broadcastStatus, setStream: publishStream } = broadcast
  const { captureStream } = audio

  // Stream-out samples the same element the stage shows, so what goes to a
  // platform is exactly the program viewers would see.
  const stream = useStreamOut({
    source: liveRef,
    audio: selected ? captureStream() : null,
    onAirChange: setStreamOn,
  })
  // The published stream is only rebuilt when its video track changes. Audio is
  // mixed live into the same destination, so toggling the announcer mic must not
  // tear the viewer tree down and build it again.
  const mixRef = useRef<{ video: MediaStreamTrack | null; stream: MediaStream | null }>({
    video: null,
    stream: null,
  })
  useEffect(() => {
    if (broadcastStatus !== 'live') return
    // The composited picture is the program; a browser that cannot composite
    // still falls back to the raw selected source.
    const program = composited ?? selected?.stream ?? null
    const video = program?.getVideoTracks()[0] ?? null
    if (!mixRef.current.stream || mixRef.current.video !== video) {
      mixRef.current = { video, stream: mixBroadcastStream(program, captureStream()) }
    }
    publishStream(mixRef.current.stream)
  }, [broadcastStatus, publishStream, composited, selected, captureStream])

  const toggleScreen = useCallback(() => {
    if (capture.status === 'live') capture.stop()
    else void capture.start()
  }, [capture.status, capture.stop, capture.start])

  const qr = useQrCode(camera.link)

  // Every host-side change to the stroke stack also travels to the co-hosts, so
  // their canvas shows the same drawing as the program.
  const commitStroke = useCallback(
    (stroke: Stroke) => {
      setPast((prev) => [...prev, stroke])
      setFuture([])
      sendOp(drawOp(stroke))
    },
    [sendOp],
  )

  const handleUndo = useCallback(() => {
    if (past.length === 0) return
    const last = past[past.length - 1]
    setPast(past.slice(0, -1))
    setFuture((fut) => [...fut, last])
    sendOp({ t: 'remove', id: last.id })
  }, [past, sendOp])

  const handleRedo = useCallback(() => {
    if (future.length === 0) return
    const last = future[future.length - 1]
    setFuture(future.slice(0, -1))
    setPast((prev) => [...prev, last])
    sendOp(drawOp(last))
  }, [future, sendOp])

  const handleClear = useCallback(() => {
    setPast([])
    setFuture([])
    sendOp({ t: 'clear' })
  }, [sendOp])

  const canUndo = past.length > 0

  /** Step through the sources — what a Stream Deck's keys or a pedal drives. */
  const cycleSource = useCallback(
    (direction: 1 | -1) => {
      if (sources.length === 0) return
      setSelectedId((current) => {
        const index = sources.findIndex((source) => source.id === current)
        if (index === -1) return sources[0].id
        const next = (index + direction + sources.length) % sources.length
        return sources[next].id
      })
    },
    [sources],
  )

  // --- Hardware triggers ----------------------------------------------------
  const handleHardware = useCallback(
    (action: HardwareAction) => {
      switch (action) {
        case 'next-source':
          cycleSource(1)
          break
        case 'prev-source':
          cycleSource(-1)
          break
        case 'start-replay':
          replay.startReplay()
          break
        case 'return-live':
          replay.returnToLive()
          break
        case 'undo':
          handleUndo()
          break
        case 'clear':
          handleClear()
          break
      }
    },
    [cycleSource, replay, handleUndo, handleClear],
  )

  const hardware = useHardware(handleHardware)

  // --- Keyboard shortcuts ---------------------------------------------------
  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      // Do not hijack shortcuts while the user is editing an input or textarea.
      if (target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA') return

      switch (event.key) {
        // Tools
        case '1':
          event.preventDefault()
          setTool('pen')
          break
        case '2':
          event.preventDefault()
          setTool('highlight')
          break
        case '3':
          event.preventDefault()
          setTool('rect')
          break
        case '4':
          event.preventDefault()
          setTool('ellipse')
          break
        // Colours
        case 'c':
        case 'C':
          event.preventDefault()
          setColor(nextColor(color))
          break
        case 'x':
        case 'X':
          event.preventDefault()
          setColor(prevColor(color))
          break
        // Undo / redo / clear
        case 'z':
        case 'Z':
          event.preventDefault()
          if (event.shiftKey) {
            handleRedo()
          } else {
            handleUndo()
          }
          break
        case 'Delete':
        case 'Backspace':
          event.preventDefault()
          handleClear()
          break
        // Sources and replay: the keys a Stream Deck or pedal is mapped to.
        case '[':
          event.preventDefault()
          cycleSource(-1)
          break
        case ']':
          event.preventDefault()
          cycleSource(1)
          break
        case 'r':
        case 'R':
          event.preventDefault()
          if (replay.replaying) replay.togglePlay()
          else replay.startReplay()
          break
        case 'l':
        case 'L':
          event.preventDefault()
          replay.returnToLive()
          break
        default:
          break
      }
    },
    [handleRedo, handleUndo, handleClear, color, cycleSource, replay],
  )

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleKeyDown])

  return (
    <>
      <div className="app">
        <main className="stage">
          {/* The canvas sits inside the stage; its strokes are owned by App. */}
          <VideoStage
            stream={selected?.stream ?? null}
            videoRef={videoRef}
            liveRef={liveRef}
            cornerStream={corner?.stream ?? null}
            cornerRef={cornerRef}
            clip={replay.clip}
            replaying={replay.replaying}
            past={past}
            tool={tool}
            color={color}
            width={width}
            onStrokeCommitted={commitStroke}
          />

          {/* Tools, inputs, audio, replay, hardware and cameraman pairing. */}
          <Sidebar
            tool={tool}
            setTool={setTool}
            color={color}
            setColor={setColor}
            canUndo={canUndo}
            onUndo={handleUndo}
            onClear={handleClear}
            screenStatus={capture.status}
            onToggleScreen={toggleScreen}
            screenNotice={capture.notice}
            cameras={cameras}
            media={media}
            camera={camera}
            qr={qr}
            sources={sources}
            selectedId={selectedId}
            onSelect={setSelectedId}
            cornerId={cornerId}
            onCornerChange={setCornerId}
            hardware={hardware}
            audio={audio}
            replay={replay}
            broadcast={broadcast}
            canBroadcast={selected !== null}
            desktop={desktop}
            mode={mode}
            onMode={changeMode}
            stream={stream}
          />
        </main>
      </div>

      {/* Desktop-only: mobile and tablet viewports get this instead of the app. */}
      <div className="unsupported" data-testid="unsupported-notice">
        <h1>Open Telestrator is a desktop app</h1>
        <p>
          The web telestrator needs a desktop browser. Mobile and tablet builds are planned as
          separate apps — follow the project on GitHub for release news.
        </p>
        <a className="btn" href={GITHUB_URL} target="_blank" rel="noreferrer">
          View on GitHub
        </a>
      </div>
    </>
  )
}
