import { useEffect, useRef, useState } from 'react'
import { useHostCamera } from '../lib/useHostCamera'
import type { StageSource } from '../lib/sources'
import { INPUT_KINDS, type SupportedInput } from '../lib/cameraDevices'

/**
 * The right sidebar: every stage input and the cameraman pairing.
 *
 *   1. Feed — a mini preview of the shared screen, the host camera and every
 *      cameraman currently streaming; the selected one is the program.
 *   2. Device — bring an input group onto the stage (share a tab, start the
 *      camera, enable the mic) with its current state spelled out.
 *   3. Cameraman — mint the magic link and show its QR code.
 */
export function VideoFeeds({
  sources,
  selectedId,
  onSelect,
  camera,
  qr,
  inputKind,
  onSelectKind,
  deviceStatus,
}: {
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
    <aside className="sidebar" data-testid="video-feeds" aria-label="Video feeds and inputs">
      <header className="sidebar__header">
        <h2>Inputs</h2>
        <p className="sidebar__hint">Pick the program source, start a device, invite a cameraman.</p>
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
              <SourceCard
                key={source.id}
                source={source}
                selected={selectedId === source.id}
                onSelect={onSelect}
              />
            ))}
          </div>
        )}
      </div>

      {/* Device selection: bring an input onto the stage. */}
      <div className="feed-panel">
        <span className="feed-panel__label">Device</span>
        <div className="swatch-row">
          {INPUT_KINDS.map((item) => (
            <button
              key={item.kind}
              type="button"
              aria-label={`Use ${item.label}`}
              aria-pressed={inputKind === item.kind}
              data-testid={`feeds-device-${item.kind}`}
              title={item.hint}
              className={`swatch swatch--icon ${inputKind === item.kind ? 'swatch--on' : ''}`}
              onClick={() => onSelectKind(item.kind)}
            >
              {item.glyph}
            </button>
          ))}
        </div>
        <p className="panel__hint" data-testid="device-status" role="status">
          {deviceStatus}
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
    <div className="feed-card__frame">
      <video
        ref={videoRef}
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
