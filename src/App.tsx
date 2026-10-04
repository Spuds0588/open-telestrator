import { useCallback, useEffect, useMemo, useState } from 'react'
import { useDisplayCapture } from './lib/capture'
import { useHostCamera } from './lib/useHostCamera'
import type { StageSource } from './lib/sources'
import { COLORS } from './lib/telestration'
import { qrOf } from './lib/qrcode'
import { scanDevices, type SupportedInput } from './lib/cameraDevices'
import { DrawingSidebar } from './components/DrawingSidebar'
import { VideoFeeds } from './components/VideoFeeds'
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

function nextWidth(current: number): number {
  return current >= 16 ? 16 : current + 1
}

function prevWidth(current: number): number {
  return current <= 2 ? 2 : current - 1
}

export default function App() {
  const capture = useDisplayCapture()
  const camera = useHostCamera()
  const busy = capture.status === 'requesting'
  const live = capture.status === 'live'

  // The stage's inputs: the host's shared screen first, then every cameraman
  // currently streaming in. Exactly one of these is the program at a time.
  const [sources] = useState<StageSource[]>([])

  // Device selection: which physical input the host wants to draw on top of.
  // The host picks the *kind* (screen, camera, audio) and the app starts the
  // matching capture; `deviceLabels` hold the human-readable choices in the
  // sidebar so the host can switch without reopening the capture picker.
  const [inputKind, setInputKind] = useState<SupportedInput>('screen')
  const initialDeviceLabels = new Map<SupportedInput, string>([
    ['screen', 'Screen (tab or window)'],
    ['camera', 'Camera (phone or webcam)'],
    ['audio', 'Audio (microphone)'],
  ])
  const [deviceLabels, setDeviceLabels] = useState<Map<SupportedInput, string>>(initialDeviceLabels)
  // Keep the selection valid: default to the first source and fall back when the
  // selected one disappears (capture stopped, cameraman hung up).
  const [selectedId, setSelectedId] = useState<string | null>(null)
  // Keep the selection valid: default to the first source and fall back when the
  // selected one disappears (capture stopped, cameraman hung up).
  useEffect(() => {
    if (!selectedId || !sources.some((source) => source.id === selectedId)) {
      setSelectedId(sources[0]?.id ?? null)
    }
  }, [sources, selectedId])

  const selected = sources.find((source) => source.id === selectedId) ?? null

  // Enumerate the host's actual devices once on start, then refresh after every
  // capture / cameraman teardown so a newly plugged-in webcam or mic shows up.
  // The snapshot is merged over the existing labels (never cleared) so a
  // freshly plugged-in device is added without dropping what was already
  // listed.
  useEffect(() => {
    let cancelled = false
    scanDevices()
      .then((snapshot) => {
        if (!cancelled) {
          if (!cancelled) {
            setDeviceLabels((prev) => {
              const next = new Map(prev)
              for (const [kind, label] of snapshot.labels) next.set(kind, label)
              return next
            })
          }
        }
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [])

  // Re-run the device snapshot whenever we (re)start a capture, so a newly
  // attached camera or mic is listed shortly after the host selects it.
  useEffect(() => {
    let cancelled = false
    scanDevices()
      .then((snapshot) => {
        if (!cancelled) {
          setDeviceLabels((prev) => {
            const next = new Map(prev)
            for (const [kind, label] of snapshot.labels) next.set(kind, label)
            return next
          })
        }
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [inputKind])

  // Drawing state owned by the host (see DrawingSidebar / TelestrationOverlay).
  const [tool, setTool] = useState<import('./lib/telestration').Tool>('pen')
  const [color, setColor] = useState<string>('#ef4444')
  const [width, setWidth] = useState(4)

  // QR code for the cameraman link so a phone can scan this page and join the
  // broadcast without typing a long magic link.
  const [qr, setQr] = useState<string | null>(null)
  useMemo(() => {
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
  const [past, setPast] = useState<import('./lib/telestration').Stroke[]>([])
  const [_future, setFuture] = useState<import('./lib/telestration').Stroke[]>([])
  const commitStroke = useCallback((stroke: import('./lib/telestration').Stroke) => {
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

  // --- Keyboard shortcuts (driven by the host's drawing state) ---------------
  // Read the latest tool/colour/width so the document-level keydown handler
  // can translate keys into the host's drawing state.
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
        // Width
        case 'w':
        case 'W':
          event.preventDefault()
          setWidth(prevWidth(width))
          break
        case 'e':
        case 'E':
          event.preventDefault()
          setWidth(nextWidth(width))
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
    [handleRedo, handleUndo, handleClear, setTool, setColor, setWidth, color, width],
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
        {/* The drawing tools now live in the sidebar, beside the video. */}
        <DrawingSidebar
          tool={tool}
          setTool={setTool}
          color={color}
          setColor={setColor}
          width={width}
          setWidth={setWidth}
          canUndo={canUndo}
          onUndo={handleUndo}
          onClear={handleClear}
          inputKind={inputKind}
          setInputKind={setInputKind}
          deviceLabels={deviceLabels}
        />

        {/* Input feeds + cameraman pairing live in the same sidebar. */}
        <VideoFeeds
          sources={sources}
          selectedId={selectedId}
          onSelect={setSelectedId}
          camera={camera}
          qr={qr}
          inputKind={inputKind}
          setInputKind={setInputKind}
          deviceLabels={deviceLabels}
        />

        {/* The canvas sits inside the stage; its strokes are owned by App. */}
        <VideoStage
          stream={selected?.stream ?? null}
          past={past}
          tool={tool}
          color={color}
          width={width}
          onStrokeCommitted={commitStroke}
        />
      </main>

      <p className="hint">
        Share a browser tab, then draw over it. The tools, sources and cameraman
        controls are all in the sidebar; switch to <strong>Control</strong> to let
        clicks reach the video, and back to <strong>Draw</strong> to keep
        annotating. Invite a cameraman to add a phone camera as a second source.
      </p>
    </div>
  )
}
