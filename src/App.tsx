import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useDisplayCapture, useCameraCapture } from './lib/capture'
import { useHostCamera } from './lib/useHostCamera'
import { useAudioMixer } from './lib/useAudioMixer'
import { useReplay } from './lib/useReplay'
import { mergeStageSources } from './lib/sources'
import { qrOf } from './lib/qrcode'
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
  const webcam = useCameraCapture()
  const camera = useHostCamera()

  // The stage's inputs, in program order: the host's shared screen, the host's
  // own camera, then every cameraman currently streaming in. Exactly one of
  // these is the program at a time.
  const sources = useMemo(
    () => mergeStageSources(capture.stream, webcam.stream, camera.sources),
    [capture.stream, webcam.stream, camera.sources],
  )

  // Keep the selection valid: default to the first source and fall back when the
  // selected one disappears (capture stopped, cameraman hung up).
  const [selectedId, setSelectedId] = useState<string | null>(null)
  useEffect(() => {
    if (selectedId && sources.some((source) => source.id === selectedId)) return
    setSelectedId(sources[0]?.id ?? null)
  }, [sources, selectedId])

  const selected = sources.find((source) => source.id === selectedId) ?? null

  // Audio and replay are owned here so their controls can live in the sidebar.
  const audio = useAudioMixer(selected?.stream ?? null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const replay = useReplay(selected?.stream ?? null, videoRef)

  const toggleScreen = useCallback(() => {
    if (capture.status === 'live') capture.stop()
    else void capture.start()
  }, [capture.status, capture.stop, capture.start])

  const toggleCamera = useCallback(() => {
    if (webcam.status === 'live') webcam.stop()
    else void webcam.start()
  }, [webcam.status, webcam.stop, webcam.start])

  // Drawing state owned by the host (see Sidebar / TelestrationOverlay). The
  // stroke width is fixed in the web MVP; a settings panel can expose it later.
  const [tool, setTool] = useState<Tool>(DEFAULT_TOOL)
  const [color, setColor] = useState<string>(DEFAULT_COLOR)
  const width = DEFAULT_WIDTH

  // QR code for the cameraman link so a phone can scan the dialog and join the
  // broadcast without typing a long magic link.
  const [qr, setQr] = useState<string | null>(null)
  useEffect(() => {
    if (!camera.link) {
      setQr(null)
      return
    }
    let cancelled = false
    qrOf(camera.link).then((dataUrl) => {
      if (!cancelled) setQr(dataUrl)
    })
    return () => {
      cancelled = true
    }
  }, [camera.link])

  // The host-owned stroke stack. `past` holds the committed strokes (most-recent)
  // and `_future` holds strokes undone so the host can redo them with Shift+Z.
  const [past, setPast] = useState<Stroke[]>([])
  const [_future, setFuture] = useState<Stroke[]>([])
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
        default:
          break
      }
    },
    [handleRedo, handleUndo, handleClear, color],
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
            clip={replay.clip}
            replaying={replay.replaying}
            past={past}
            tool={tool}
            color={color}
            width={width}
            onStrokeCommitted={commitStroke}
          />

          {/* Tools, inputs, audio, replay and cameraman pairing. */}
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
            webcamStatus={webcam.status}
            onToggleCamera={toggleCamera}
            webcamNotice={webcam.notice}
            camera={camera}
            qr={qr}
            sources={sources}
            selectedId={selectedId}
            onSelect={setSelectedId}
            audio={audio}
            replay={replay}
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
