import { Pause, Play, Rewind, Square } from 'lucide-react'
import type { ReplayController } from '../lib/useReplay'

/** Instant-replay affordances in the sidebar. */
export function ReplayControls({
  available,
  windowSeconds,
  replaying,
  paused,
  startReplay,
  returnToLive,
  togglePlay,
}: ReplayController) {
  return (
    <div
      className="replay"
      data-testid="replay-controls"
      data-state={replaying ? 'replaying' : available ? 'ready' : 'waiting'}
    >
      {replaying ? (
        <>
          <div className="replay__row">
            <span className="replay__badge" title="Slow motion">
              0.5×
            </span>
            <button
              type="button"
              className="chip"
              data-testid="replay-toggle"
              onClick={togglePlay}
            >
              {paused ? <Play aria-hidden="true" /> : <Pause aria-hidden="true" />}
              {paused ? 'Play' : 'Pause'}
            </button>
          </div>
          <button
            type="button"
            className="chip chip--wide"
            data-testid="replay-live"
            onClick={returnToLive}
          >
            <Square aria-hidden="true" />
            Return to live
          </button>
        </>
      ) : (
        <>
          <button
            type="button"
            className="chip chip--wide"
            data-testid="replay-start"
            disabled={!available}
            onClick={startReplay}
            title="Play the last several seconds at 0.5× speed"
          >
            <Rewind aria-hidden="true" />
            Instant replay
          </button>
          <span className="replay__note" data-testid="replay-note">
            {available ? `${windowSeconds}s buffered` : 'buffering…'}
          </span>
        </>
      )}
    </div>
  )
}
