import { useEffect, useMemo, useState } from 'react'
import { useDisplayCapture } from './lib/capture'
import { useHostCamera } from './lib/useHostCamera'
import type { StageSource } from './lib/sources'
import { VideoStage } from './components/VideoStage'
import { SourcePicker } from './components/SourcePicker'

export default function App() {
  const capture = useDisplayCapture()
  const camera = useHostCamera()
  const busy = capture.status === 'requesting'
  const live = capture.status === 'live'

  // The stage's inputs: the host's shared screen first, then every cameraman
  // currently streaming in. Exactly one of these is the program at a time.
  const sources = useMemo<StageSource[]>(() => {
    const list: StageSource[] = []
    if (capture.stream) {
      list.push({ id: 'screen', label: 'Shared screen', kind: 'screen', stream: capture.stream })
    }
    for (const source of camera.sources) {
      list.push({ id: `camera:${source.id}`, label: source.label, kind: 'camera', stream: source.stream })
    }
    return list
  }, [capture.stream, camera.sources])

  // Keep the selection valid: default to the first source and fall back when the
  // selected one disappears (capture stopped, cameraman hung up).
  const [selectedId, setSelectedId] = useState<string | null>(null)
  useEffect(() => {
    if (selectedId && sources.some((source) => source.id === selectedId)) return
    setSelectedId(sources[0]?.id ?? null)
  }, [sources, selectedId])

  const selected = sources.find((source) => source.id === selectedId) ?? null

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

      <main className="app__main">
        <SourcePicker
          sources={sources}
          selectedId={selectedId}
          onSelect={setSelectedId}
          camera={camera}
        />
        {/* Only the selected source ever reaches the stage, so replay and audio
            still see exactly one stream at a time. */}
        <VideoStage stream={selected?.stream ?? null} />
        <p className="hint">
          Share a browser tab, then draw over it. Switch to <strong>Control</strong> to let
          clicks reach the video, and back to <strong>Draw</strong> to keep annotating. Invite a
          cameraman to add a phone camera as a second source.
        </p>
      </main>
    </div>
  )
}
