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
              {paused ? '▶ Play' : '⏸ Pause'}
            </button>
          </div>
          <button
            type="button"
            className="chip chip--wide"
            data-testid="replay-live"
            onClick={returnToLive}
          >
            ⏹ Return to live
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
            ⏪ Instant replay
          </button>
          <span className="replay__note" data-testid="replay-note">
            {available ? `${windowSeconds}s buffered` : 'buffering…'}
          </span>
        </>
      )}
    </div>
  )
}
