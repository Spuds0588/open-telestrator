import { useDisplayCapture } from './lib/capture'
import { VideoStage } from './components/VideoStage'

export default function App() {
  const { status, stream, notice, start, stop } = useDisplayCapture()
  const busy = status === 'requesting'
  const live = status === 'live'

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand__dot" aria-hidden="true" />
          <h1>Open Telestrator</h1>
        </div>
        <div className="topbar__actions" data-state={status} data-testid="capture-state">
          {notice && (
            <span
              className={`status status--${status === 'denied' ? 'denied' : 'error'}`}
              role="alert"
            >
              {notice}
            </span>
          )}
          {live ? (
            <button
              type="button"
              className="btn btn--ghost"
              data-testid="stop-capture"
              onClick={stop}
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
              onClick={() => void start()}
            >
              {busy ? 'Waiting for selection…' : 'Share a tab'}
            </button>
          )}
        </div>
      </header>

      <main className="app__main">
        <VideoStage stream={stream} />
        <p className="hint">
          Share a browser tab, then draw over it. Switch to <strong>Control</strong> to let
          clicks reach the video, and back to <strong>Draw</strong> to keep annotating.
        </p>
      </main>
    </div>
  )
}
