import { useEffect, useRef, useState } from 'react'
import { useHostCamera } from '../lib/useHostCamera'
import type { StageSource } from '../lib/sources'
import { INPUT_KINDS, type SupportedInput } from '../lib/cameraDevices'
import { ALL_TOOLS, COLORS, toolGlyph, type Tool } from '../lib/telestration'

/**
 * The single control sidebar, on the right of the stage.
 *
 * Everything the host touches lives here as one compressed column: the drawing
 * tools, the input picker with its live feed list, and the cameraman pairing.
 * Keyboard shortcuts are shown as small badges on the controls they belong to
 * instead of a separate legend.
 */
export function Sidebar({
  tool,
  setTool,
  color,
  setColor,
  canUndo,
  onUndo,
  onClear,
  sources,
  selectedId,
  onSelect,
  camera,
  qr,
  inputKind,
  onSelectKind,
  deviceStatus,
}: {
  tool: Tool
  setTool: (tool: Tool) => void
  color: string
  setColor: (color: string) => void
  canUndo: boolean
  onUndo: () => void
  onClear: () => void
  sources: StageSource[]
  selectedId: string | null
  onSelect: (id: string) => void
  camera: ReturnType<typeof useHostCamera>
  qr: string | null
  inputKind: SupportedInput
  onSelectKind: (kind: SupportedInput) => void
  deviceStatus: string
}) {
  return (
    <aside className="sidebar" data-testid="sidebar" aria-label="Controls">
      <section className="side-group">
        <h2 className="side-title">Draw</h2>
        <div className="row">
          {ALL_TOOLS.map((item, index) => (
            <button
              key={item}
              type="button"
              aria-label={`Select ${item} tool`}
              aria-pressed={tool === item}
              data-testid={`sidebar-tool-${item}`}
              className={`icon-btn ${tool === item ? 'icon-btn--on' : ''}`}
              onClick={() => setTool(item)}
            >
              {toolGlyph(item)}
              <span className="key-badge">{index + 1}</span>
            </button>
          ))}
        </div>
        <div className="row row--badged">
          {COLORS.map((swatch) => (
            <button
              key={swatch}
              type="button"
              aria-label={`Select colour ${swatch}`}
              aria-pressed={color === swatch}
              data-testid={`sidebar-colour-${swatch}`}
              className={`swatch ${color === swatch ? 'swatch--on' : ''}`}
              style={{ background: swatch }}
              onClick={() => setColor(swatch)}
            />
          ))}
          <span className="key-badge key-badge--row">C X</span>
        </div>
        <div className="row">
          <button
            type="button"
            className="icon-btn"
            data-testid="sidebar-undo"
            onClick={onUndo}
            disabled={!canUndo}
            title="Undo last stroke"
          >
            ↺<span className="key-badge">Z</span>
          </button>
          <button
            type="button"
            className="icon-btn"
            data-testid="sidebar-clear"
            onClick={onClear}
            disabled={!canUndo}
            title="Clear all strokes"
          >
            🗑<span className="key-badge">Del</span>
          </button>
        </div>
      </section>

      <section className="side-group">
        <h2 className="side-title">Inputs</h2>
        <div className="row">
          {INPUT_KINDS.map((item) => (
            <button
              key={item.kind}
              type="button"
              aria-label={`Use ${item.label}`}
              aria-pressed={inputKind === item.kind}
              data-testid={`feeds-device-${item.kind}`}
              title={item.hint}
              className={`icon-btn ${inputKind === item.kind ? 'icon-btn--on' : ''}`}
              onClick={() => onSelectKind(item.kind)}
            >
              {item.glyph}
            </button>
          ))}
        </div>
        <p className="side-status" data-testid="device-status" role="status">
          {deviceStatus}
        </p>
        {sources.length === 0 ? (
          <span className="side-empty" data-testid="feeds-empty">
            No feeds yet
          </span>
        ) : (
          <div className="feed-list">
            {sources.map((source) => (
              <FeedCard
                key={source.id}
                source={source}
                selected={selectedId === source.id}
                onSelect={onSelect}
              />
            ))}
          </div>
        )}
      </section>

      <section className="side-group">
        <h2 className="side-title">Cameraman</h2>
        {camera.link ? (
          <>
            <input
              className="link-input"
              data-testid="camera-link"
              readOnly
              value={camera.link}
              aria-label="Cameraman link"
              onFocus={(event) => event.currentTarget.select()}
            />
            <div className="qr" data-testid="camera-qr">
              {qr ? (
                <img src={qr} alt="Scan to join the camera broadcast" />
              ) : (
                <span className="side-empty">QR</span>
              )}
            </div>
            <div className="row">
              <button
                type="button"
                className="chip"
                data-testid="camera-copy"
                onClick={() =>
                  void navigator.clipboard?.writeText(camera.link ?? '').catch(() => undefined)
                }
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
          <span className="side-note" data-testid="camera-notice" role="alert">
            {camera.notice}
          </span>
        )}
      </section>
    </aside>
  )
}

/** A single feed row: a small live thumbnail plus its label. */
function FeedCard({
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
      <FeedPreview src={source} />
      <span className="feed-card__label">{source.label}</span>
    </button>
  )
}

/** The thumbnail: object-fit contain, so a tab or phone feed never crops. */
function FeedPreview({ src }: { src: StageSource }) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    setLoaded(false)
    video.srcObject = src.stream
    void video.play().catch(() => undefined)
    return () => {
      video.srcObject = null
    }
  }, [src.stream])

  return (
    <span className="feed-card__frame">
      <video
        ref={videoRef}
        className="feed-card__video"
        playsInline
        muted
        onLoadedData={() => setLoaded(true)}
        aria-hidden="true"
      />
      {!loaded && <span className="feed-card__placeholder">…</span>}
    </span>
  )
}
