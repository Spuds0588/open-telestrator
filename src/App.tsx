import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useDisplayCapture } from './lib/capture'
import { useHostCamera } from './lib/useHostCamera'
import { useHostCameras } from './lib/useHostCameras'
import { useMediaFeeds } from './lib/useMediaFeeds'
import { useAudioMixer } from './lib/useAudioMixer'
import { useReplay } from './lib/useReplay'
import { mergeStageSources } from './lib/sources'
import { useBroadcast } from './lib/useBroadcast'
import { mixBroadcastStream } from './lib/broadcast'
import { useProgramCompositor } from './lib/useProgramCompositor'
import { useQrCode } from './lib/useQrCode'
import { useHardware } from './lib/useHardware'
import type { HardwareAction } from './lib/hardware'
import {
  COLORS,
  DEFAULT_COLOR,
  DEFAULT_TOOL,
  DEFAULT_WIDTH,
  type Stroke,
  type Tool,
} from './lib/telestration'
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
  const camera = useHostCamera(broadcast.viewers)

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
          id: `camera:${source.id}`,
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

  // Drawing state owned by the host (see Sidebar / TelestrationOverlay). The
  // stroke width is fixed in the web MVP; a settings panel can expose it later.
  const [tool, setTool] = useState<Tool>(DEFAULT_TOOL)
  const [color, setColor] = useState<string>(DEFAULT_COLOR)
  const width = DEFAULT_WIDTH

  // Audio and replay are owned here so their controls can live in the sidebar.
  const audio = useAudioMixer(selected?.stream ?? null, selectedElement)
  const videoRef = useRef<HTMLVideoElement>(null)
  const replay = useReplay(selected?.stream ?? null, videoRef)

  // The host-owned stroke stack. `past` holds the committed strokes (most-recent)
  // and `_future` holds strokes undone so the host can redo them with Shift+Z.
  const [past, setPast] = useState<Stroke[]>([])
  const [_future, setFuture] = useState<Stroke[]>([])

  // The stage is the program: the compositor redraws it — video, corners and
  // strokes — into one stream while viewers are being fed.
  const liveRef = useRef<HTMLVideoElement>(null)
  const cornerRef = useRef<HTMLVideoElement>(null)
  const composited = useProgramCompositor({
    active: broadcast.status === 'live',
    videoRef,
    liveRef,
    cornerRef,
    strokes: past,
    replaying: replay.replaying,
  })

  // The host publishes the composited picture plus the stage audio mix.
  const { status: broadcastStatus, setStream: publishStream } = broadcast
  const { captureStream } = audio
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

  const commitStroke = useCallback((stroke: Stroke) => {
    setPast((prev) => [...prev, stroke])
    setFuture([])
  }, [])

  const handleUndo = useCallback(() => {
    setPast((prev) => {
      if (prev.length === 0) return prev
      const last = prev[prev.length - 1]
      setFuture((f) => [...f, last])
      return prev.slice(0, -1)
    })
  }, [])

  const handleRedo = useCallback(() => {
    setFuture((fut) => {
      if (fut.length === 0) return fut
      const last = fut[fut.length - 1]
      setPast((p) => [...p, last])
      return fut.slice(0, -1)
    })
  }, [])

  const handleClear = useCallback(() => {
    setPast([])
    setFuture([])
  }, [])

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
