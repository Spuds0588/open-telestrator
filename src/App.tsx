import { useCallback, useEffect, useMemo, useState } from 'react'
import { useDisplayCapture, useCameraCapture, type CaptureStatus } from './lib/capture'
import { useHostCamera } from './lib/useHostCamera'
import { useAudioMixer } from './lib/useAudioMixer'
import { mergeStageSources } from './lib/sources'
import { qrOf } from './lib/qrcode'
import { inputStatusText, type InputPhase, type SupportedInput } from './lib/cameraDevices'
import type { MicStatus } from './lib/audio'
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

/** Map a capture lifecycle onto the sidebar's coarse input phase. */
function capturePhase(status: CaptureStatus): InputPhase {
  switch (status) {
    case 'requesting':
      return 'requesting'
    case 'live':
      return 'live'
    case 'denied':
    case 'error':
      return 'problem'
    default:
      return 'off'
  }
}

/** Map the microphone lifecycle onto the sidebar's coarse input phase. */
function micPhase(status: MicStatus): InputPhase {
  switch (status) {
    case 'requesting':
      return 'requesting'
    case 'on':
      return 'live'
    case 'denied':
    case 'error':
      return 'problem'
    default:
      return 'off'
  }
}

export default function App() {
  const capture = useDisplayCapture()
  const webcam = useCameraCapture()
  const camera = useHostCamera()
  const busy = capture.status === 'requesting'
  const live = capture.status === 'live'

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

  // Audio is owned here (not by the stage) so the input picker can switch the
  // announcer mic on; the mixer follows whichever source is on the program.
  const audio = useAudioMixer(selected?.stream ?? null)

  // Device selection: the host picks the input kind and the matching capture
  // starts. Screen and camera become stage sources; audio joins the mix.
  const [inputKind, setInputKind] = useState<SupportedInput>('screen')
  const selectDevice = useCallback(
    (kind: SupportedInput) => {
      setInputKind(kind)
      if (kind === 'screen') void capture.start()
      else if (kind === 'camera') void webcam.start()
      else if (audio.micStatus !== 'on') void audio.enableMic()
    },
    [capture.start, webcam.start, audio.enableMic, audio.micStatus],
  )
  const devicePhase: Record<SupportedInput, InputPhase> = {
    screen: capturePhase(capture.status),
    camera: capturePhase(webcam.status),
    audio: micPhase(audio.micStatus),
  }
  const deviceStatus = inputStatusText(inputKind, devicePhase[inputKind])

  // Drawing state owned by the host (see Sidebar / TelestrationOverlay). The
  // stroke width is fixed in the web MVP; a settings panel can expose it later.
  const [tool, setTool] = useState<Tool>(DEFAULT_TOOL)
  const [color, setColor] = useState<string>(DEFAULT_COLOR)
  const width = DEFAULT_WIDTH

  // QR code for the cameraman link so a phone can scan this page and join the
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
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand__dot" aria-hidden="true" />
          <h1>Open Telestrator</h1>
        </div>
        <div className="topbar__actions" data-state={capture.status} data-testid="capture-state">
          {capture.notice && (
            <span
              className={`status status--${capture.status === 'denied' ? 'denied' : 'error'}`}
              role="alert"
            >
              {capture.notice}
            </span>
          )}
          {live ? (
            <button
              type="button"
              className="btn btn--ghost"
              data-testid="stop-capture"
              onClick={capture.stop}
            >
              Stop sharing
            </button>
          ) : (
            <button
              type="button"
              className="btn"
              data-testid="start-capture"
              aria-busy={busy}
              disabled={busy}
              onClick={() => void capture.start()}
            >
              {busy ? 'Waiting for selection…' : 'Share a tab'}
            </button>
          )}
        </div>
      </header>

      <main className="stage">
        {/* The canvas sits inside the stage; its strokes are owned by App. */}
        <VideoStage
          stream={selected?.stream ?? null}
          past={past}
          tool={tool}
          color={color}
          width={width}
          audio={audio}
          onStrokeCommitted={commitStroke}
        />

        {/* Tools, inputs and cameraman pairing in one compact column. */}
        <Sidebar
          tool={tool}
          setTool={setTool}
          color={color}
          setColor={setColor}
          canUndo={canUndo}
          onUndo={handleUndo}
          onClear={handleClear}
          sources={sources}
          selectedId={selectedId}
          onSelect={setSelectedId}
          camera={camera}
          qr={qr}
          inputKind={inputKind}
          onSelectKind={selectDevice}
          deviceStatus={deviceStatus}
        />
      </main>
    </div>
  )
}
