import { useEffect, useRef, useState } from 'react'
import type { CaptureStatus } from '../lib/capture'
import { useHostCamera } from '../lib/useHostCamera'
import type { StageSource } from '../lib/sources'
import type { AudioController } from '../lib/useAudioMixer'
import type { ReplayController } from '../lib/useReplay'
import { ALL_TOOLS, COLORS, toolGlyph, type Tool } from '../lib/telestration'
import { AudioControls } from './AudioControls'
import { ReplayControls } from './ReplayControls'
import { QrModal } from './QrModal'

/**
 * The single control sidebar, on the right of the stage: drawing tools, the
 * input stack (share a tab, camera, cameraman and every live feed), the audio
 * mixer and replay. Keyboard shortcuts are badges on the controls they belong
 * to instead of a legend.
 */
export function Sidebar({
  tool,
  setTool,
  color,
  setColor,
  canUndo,
  onUndo,
  onClear,
  screenStatus,
  onToggleScreen,
  screenNotice,
  webcamStatus,
  onToggleCamera,
  webcamNotice,
  camera,
  qr,
  sources,
  selectedId,
  onSelect,
  audio,
  replay,
}: {
  tool: Tool
  setTool: (tool: Tool) => void
  color: string
  setColor: (color: string) => void
  canUndo: boolean
  onUndo: () => void
  onClear: () => void
  screenStatus: CaptureStatus
  onToggleScreen: () => void
  screenNotice: string | null
  webcamStatus: CaptureStatus
  onToggleCamera: () => void
  webcamNotice: string | null
  camera: ReturnType<typeof useHostCamera>
  qr: string | null
  sources: StageSource[]
  selectedId: string | null
  onSelect: (id: string) => void
  audio: AudioController
  replay: ReplayController
}) {
  // The QR dialog opens as soon as a cameraman link is minted, and can be
  // reopened from the input buttons later.
  const [showQr, setShowQr] = useState(false)
  useEffect(() => {
    if (camera.link) setShowQr(true)
  }, [camera.link])

  const screenLabel =
    screenStatus === 'live' ? 'Stop sharing' : screenStatus === 'requesting' ? 'Waiting…' : 'Share a tab'
  const webcamLabel =
    webcamStatus === 'live' ? 'Stop camera' : webcamStatus === 'requesting' ? 'Starting…' : 'Camera'
  const cameramanLabel = camera.link
    ? '🎥 Show QR'
    : camera.status === 'opening'
      ? 'Connecting…'
      : '🎥 Cameraman'

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
        <h2 className="side-title">Input</h2>
        <div className="btn-grid">
          <button
            type="button"
            className="chip chip--wide"
            data-testid="start-capture"
            aria-busy={screenStatus === 'requesting'}
            disabled={screenStatus === 'requesting'}
            onClick={onToggleScreen}
          >
            {screenLabel}
          </button>
          <button
            type="button"
            className="chip"
            data-testid="webcam-toggle"
            aria-busy={webcamStatus === 'requesting'}
            disabled={webcamStatus === 'requesting'}
            onClick={onToggleCamera}
          >
            {webcamLabel}
          </button>
          <button
            type="button"
            className="chip"
            data-testid="create-camera-link"
            disabled={camera.status === 'opening'}
            onClick={camera.link ? () => setShowQr(true) : camera.createLink}
          >
            {cameramanLabel}
          </button>
        </div>
        {camera.link && (
          <div className="row">
            <button type="button" className="chip" data-testid="camera-stop" onClick={camera.stop}>
              Stop cameraman
            </button>
          </div>
        )}
        {screenNotice && (
          <p className="side-note" data-testid="screen-notice" role="alert">
            {screenNotice}
          </p>
        )}
        {webcamNotice && (
          <p className="side-note" data-testid="webcam-notice" role="alert">
            {webcamNotice}
          </p>
        )}
        {camera.notice && (
          <p className="side-note" data-testid="camera-notice" role="alert">
            {camera.notice}
          </p>
        )}
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
        <h2 className="side-title">Audio</h2>
        <AudioControls {...audio} />
      </section>

      <section className="side-group">
        <h2 className="side-title">Replay</h2>
        <ReplayControls {...replay} />
      </section>

      {showQr && camera.link && (
        <QrModal
          title="Cameraman link"
          url={camera.link}
          qr={qr}
          onClose={() => setShowQr(false)}
        />
      )}
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
