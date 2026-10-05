import { useEffect } from 'react'

/**
 * A large QR code over the stage, sized so a phone can scan it from across a
 * room. The link is shown and copyable in the same dialog, so it works both for
 * scanning and for pasting into a chat.
 */
export function QrModal({
  title,
  url,
  qr,
  onClose,
}: {
  title: string
  url: string
  qr: string | null
  onClose: () => void
}) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  return (
    <div className="modal" data-testid="qr-modal" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="modal__panel" onClick={(event) => event.stopPropagation()}>
        <h2 className="modal__title">{title}</h2>
        {qr ? (
          <img className="modal__qr" data-testid="modal-qr" src={qr} alt="Scan to join" />
        ) : (
          <span className="side-empty">Generating QR…</span>
        )}
        <div className="modal__url">
          <input
            className="link-input"
            data-testid="modal-url"
            readOnly
            value={url}
            aria-label="Link"
            onFocus={(event) => event.currentTarget.select()}
          />
          <button
            type="button"
            className="chip"
            data-testid="modal-copy"
            onClick={() => void navigator.clipboard?.writeText(url).catch(() => undefined)}
          >
            Copy
          </button>
        </div>
        <button type="button" className="btn" data-testid="modal-close" onClick={onClose}>
          Done
        </button>
      </div>
    </div>
  )
}
