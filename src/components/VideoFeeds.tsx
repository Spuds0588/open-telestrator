import { useState } from 'react'
import { useHostCamera } from '../lib/useHostCamera'
import type { StageSource } from '../lib/sources'
import { INPUT_KINDS, type SupportedInput, kindIsSelectable } from '../lib/cameraDevices'

/**
 * The left sidebar holds two halves:
 *
 *   1. The input-feed viewer — a live mini-preview of every source on the
 *      program and every cameraman currently streaming, plus the host's own
 *      screen/camera switch and the magic-link that invites a cameraman.
 *   2. The drawing sidebar — tool, colour, width, undo and clear, all in the
 *      same column so the host never loses sight of the stage.
 *
 * Only the selected feed reaches the stage; the previews are for browsing,
 * not for switching the program by themselves.
 */
export function VideoFeeds({
  sources,
  selectedId,
  onSelect,
  camera,
  qr,
  inputKind,
  setInputKind,
  deviceLabels,
}: {
  sources: StageSource[]
  selectedId: string | null
  onSelect: (id: string) => void
  camera: ReturnType<typeof useHostCamera>
  qr: string | null
  inputKind: SupportedInput
  setInputKind: (kind: SupportedInput) => void
  deviceLabels: Map<SupportedInput, string>
}) {
  /** Single device-select button, pulled out of JSX so `?.`/`??` parse cleanly. */
  function deviceButton(kind: SupportedInput, disabled: boolean): JSX.Element {
    const item = INPUT_KINDS.find((i) => i.kind === kind)
    const isOn = inputKind === kind
    return (
      <button
        key={kind}
        type="button"
        aria-label={`Use ${item?.label ?? kind}`}
        aria-pressed={isOn}
        data-testid={`feeds-device-${kind}`}
        className={`swatch ${isOn ? 'swatch--on' : ''}`}
        style={{ background: item?.glyph ?? 'var(--panel-3)' }}
        onClick={() => setInputKind(kind)}
        disabled={disabled}
      >
        {item ? item.glyph : '—'}
      </button>
    )
  }

  return (
    <aside className="sidebar" data-testid="video-feeds" aria-label="Video feeds and inputs">
      <header className="sidebar__header">
        <h2>Inputs</h2>
        <p className="sidebar__hint">Pick which source is on the program, and invite a cameraman.</p>
      </header>

      <div className="feed-panel">
        <span className="feed-panel__label">Feed</span>
        {sources.length === 0 ? (
          <span className="feed-panel__empty" data-testid="feeds-empty">
            none yet
          </span>
        ) : (
          <div className="feed-cards">
            {sources.map((source) => (
              <SourceCard key={source.id} source={source} selected={selectedId === source.id} onSelect={onSelect} />
            ))}
          </div>
        )}
      </div>

      {/* Device selection: choose which physical video device to draw over. */}
      <div className="feed-panel">
        <span className="feed-panel__label">Device</span>
        <div className="swatch-row">
          {(Object.keys(INPUT_KINDS) as SupportedInput[]).map((kind) =>
            deviceButton(kind, kindIsSelectable(kind))
          )}
        </div>
        <p className="panel__hint">
          {Array.from(deviceLabels.entries()).map(([k, label]) => (
            <span key={k}>
              {inputKind === k ? <strong>{label}</strong> : <label>{label}</label>}
            </span>
          ))}
        </p>
      </div>

      <div className="feed-panel">
        <span className="feed-panel__label">Cameraman</span>
        {camera.link ? (
          <>
            <input
              className="feed-panel__link"
              data-testid="camera-link"
              readOnly
              value={camera.link}
              aria-label="Cameraman link"
              onFocus={(event) => event.currentTarget.select()}
            />
            <div className="qr" data-testid="camera-qr">
              {qr ? <img src={qr} alt="Scan to join the camera broadcast" /> : <span className="qr__placeholder">QR</span>}
            </div>
            <div className="action-row">
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
            </div>
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
          <span className="feed-panel__notice" data-testid="camera-notice" role="alert">
            {camera.notice}
          </span>
        )}
      </div>
    </aside>
  )
}

/**
 * A single feed card: a mini preview of the input plus its label, so the host
 * can see what each source shows before selecting it.
 */
function SourceCard({
  source,
  selected,
  onSelect,
}: {
  source: StageSource
  selected: boolean
  onSelect: (id: string) => void
}) {
  return (
    <button
      type="button"
      aria-label={`Show ${source.label}`}
      aria-pressed={selected}
      data-testid={`feed-${source.kind}`}
      data-source-id={source.id}
      className={`feed-card ${selected ? 'feed-card--on' : ''}`}
      onClick={() => onSelect(source.id)}
    >
      <Preview src={source} />
      <span className="feed-card__label">{source.label}</span>
    </button>
  )
}

/**
 * A mini preview window of a single input feed. The video is laid out
 * object-fit: contain so a tab, a phone camera or a game capture never crops.
 */
function Preview({ src }: { src: StageSource }) {
  const [loaded, setLoaded] = useState(false)
  return (
    <div className="feed-card__frame">
      <video
        className="feed-card__video"
        playsInline
        muted
        onLoadedData={() => setLoaded(true)}
        aria-hidden="true"
      />
      {!loaded && <span className="feed-card__placeholder">feed</span>}
      {src.kind === 'camera' && <span className="feed-card__badge">🎥 camera</span>}
    </div>
  )
}
