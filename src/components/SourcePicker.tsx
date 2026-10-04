import type { StageSource } from '../lib/sources'
import type { HostCamera } from '../lib/useHostCamera'

interface SourcePickerProps {
  sources: StageSource[]
  selectedId: string | null
  onSelect: (id: string) => void
  camera: HostCamera
}

/**
 * Host controls for stage inputs: pick which source is on the program, and mint
 * the magic link that invites a cameraman. Deliberately plain — the link is the
 * whole pairing UI.
 */
export function SourcePicker({ sources, selectedId, onSelect, camera }: SourcePickerProps) {
  return (
    <div className="sources" data-testid="source-picker">
      <div className="sources__list">
        <span className="sources__label">Sources</span>
        {sources.length === 0 ? (
          <span className="sources__empty" data-testid="sources-empty">
            none yet
          </span>
        ) : (
          sources.map((source) => (
            <button
              key={source.id}
              type="button"
              className={`chip ${selectedId === source.id ? 'chip--on' : ''}`}
              data-testid={`source-${source.kind}`}
              data-source-id={source.id}
              aria-pressed={selectedId === source.id}
              onClick={() => onSelect(source.id)}
              title={`Show ${source.label}`}
            >
              {source.kind === 'screen' ? '🖥' : '🎥'} {source.label}
            </button>
          ))
        )}
      </div>

      <div className="sources__camera">
        {camera.link ? (
          <>
            <input
              className="sources__link"
              data-testid="camera-link"
              readOnly
              value={camera.link}
              aria-label="Cameraman link"
              onFocus={(event) => event.currentTarget.select()}
            />
            <button
              type="button"
              className="chip"
              data-testid="camera-copy"
              onClick={() => void navigator.clipboard?.writeText(camera.link ?? '').catch(() => undefined)}
            >
              Copy
            </button>
            <button type="button" className="chip" data-testid="camera-stop" onClick={camera.stop}>
              Stop
            </button>
          </>
        ) : (
          <button
            type="button"
            className="chip"
            data-testid="create-camera-link"
            disabled={camera.status === 'opening'}
            onClick={camera.createLink}
          >
            {camera.status === 'opening' ? 'Connecting…' : '🎥 Invite a cameraman'}
          </button>
        )}
        {camera.notice && (
          <span className="audio__notice" data-testid="camera-notice" role="alert">
            {camera.notice}
          </span>
        )}
      </div>
    </div>
  )
}
