import { ExternalLink, X } from 'lucide-react'
import type { UpdateController } from '../lib/useUpdates'

/**
 * The one thing the app ever says about itself: a newer version exists.
 *
 * It sits over the top of the studio rather than inside a panel, because it is
 * not part of any group's work — it arrives once, from outside, some seconds
 * after launch. Everything about how loud it is belongs to `useUpdates`; this is
 * the shape of it.
 *
 * There is no download here and no restart, on purpose. The app is a standalone
 * executable, so the honest offer is the release page in the operator's own
 * browser, where they can see what they are getting before they get it.
 *
 * The opt-out is deliberately *in* the prompt rather than buried in a settings
 * panel: somebody who has decided not to be told again should be able to say so
 * at the moment they decide it. Unticking it is how they change their mind, and
 * the tray's **Check for updates** still answers even while it is ticked.
 */
export function UpdateNotice({ update }: { update: UpdateController }) {
  const { notice } = update
  if (!notice) return null

  if (notice.kind === 'quiet') {
    return (
      <div className="updates updates--quiet" role="status" data-testid="update-quiet">
        <span className="updates__quiet-text">{notice.text}</span>
        <button className="updates__close" onClick={update.dismiss} aria-label="Dismiss">
          <X aria-hidden />
        </button>
      </div>
    )
  }

  return (
    <div className="updates" role="dialog" aria-label="Update available" data-testid="update-notice">
      <span className="updates__icon" aria-hidden>
        <ExternalLink />
      </span>
      <div className="updates__body">
        <p className="updates__title" data-testid="update-title">
          Open Telestrator {notice.version} is available
        </p>
        <p className="updates__sub">
          {notice.current ? `You have ${notice.current}.` : 'A newer version has been released.'}
        </p>
        {notice.notes && <p className="updates__notes">{notice.notes}</p>}
        {update.failure && (
          <p className="updates__error" data-testid="update-failure">
            {update.failure}
          </p>
        )}

        <div className="updates__actions">
          <button
            className="btn"
            onClick={update.open}
            disabled={update.phase === 'opening'}
            data-testid="update-open"
          >
            <ExternalLink aria-hidden />
            {update.phase === 'opening' ? 'Opening…' : 'Get the new version'}
          </button>
          <button className="btn btn--ghost" onClick={update.dismiss} data-testid="update-later">
            Not now
          </button>
        </div>

        <label className="updates__mute">
          <input
            type="checkbox"
            checked={update.muted}
            onChange={(event) => update.setMuted(event.target.checked)}
            data-testid="update-mute"
          />
          Do not tell me about new versions
        </label>
      </div>
      <button className="updates__close" onClick={update.dismiss} aria-label="Dismiss">
        <X aria-hidden />
      </button>
    </div>
  )
}
