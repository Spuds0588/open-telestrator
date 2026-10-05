import { useEffect, useRef, useState } from 'react'
import type { CaptureStatus } from '../lib/capture'
import { useHostCamera } from '../lib/useHostCamera'
import type { HostCameras } from '../lib/useHostCameras'
import type { MediaFeeds } from '../lib/useMediaFeeds'
import type { HardwareController } from '../lib/useHardware'
import { HARDWARE_HINT } from '../lib/hardware'
import { sourceRemoval, type StageSource } from '../lib/sources'
import type { AudioController } from '../lib/useAudioMixer'
import type { ReplayController } from '../lib/useReplay'
import type { BroadcastController } from '../lib/useBroadcast'
import { useQrCode } from '../lib/useQrCode'
import { ALL_TOOLS, COLORS, toolGlyph, type Tool } from '../lib/telestration'
import { AudioControls } from './AudioControls'
import { MediaTransport } from './MediaTransport'
import { ReplayControls } from './ReplayControls'
import { QrModal } from './QrModal'
import { AddInputModal } from './AddInputModal'

/**
 * The single control sidebar, on the right of the stage: drawing tools, the
 * input stack (a shared tab, the host's cameras, opened videos and every live
 * feed), the program's corner camera, the audio mixer, replay, the **Co-hosts**
 * group (invite, who is connected, drop one), broadcast and the hardware
 * triggers.
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
  cameras,
  media,
  camera,
  qr,
  sources,
  selectedId,
  onSelect,
  cornerId,
  onCornerChange,
  hardware,
  audio,
  replay,
  broadcast,
  canBroadcast,
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
  cameras: HostCameras
  media: MediaFeeds
  camera: ReturnType<typeof useHostCamera>
  qr: string | null
  sources: StageSource[]
  selectedId: string | null
  onSelect: (id: string) => void
  cornerId: string | null
  onCornerChange: (id: string | null) => void
  hardware: HardwareController
  audio: AudioController
  replay: ReplayController
  broadcast: BroadcastController
  canBroadcast: boolean
}) {
  // The QR dialog opens as soon as a cameraman link is minted, and can be
  // reopened from the input buttons later.
  const [showQr, setShowQr] = useState(false)
  const [showWatchQr, setShowWatchQr] = useState(false)
  const [showAdd, setShowAdd] = useState(false)
  const viewerQr = useQrCode(broadcast.link)
  useEffect(() => {
    if (camera.link) setShowQr(true)
  }, [camera.link])

  // The transport only makes sense for an opened file or stream.
  const selectedMedia = media.feeds.find((feed) => feed.id === selectedId) ?? null

  /** Stop one input from the list: the screen, one of the host's cameras, or a
   * opened file/stream. A co-host's camera is not removable here. */
  const removeInput = (source: StageSource) => {
    const removal = sourceRemoval(source)
    if (!removal) return
    if (removal.by === 'screen') onToggleScreen()
    else if (removal.by === 'camera') cameras.stop(removal.deviceId)
    else media.stop(removal.id)
  }

  const inviteLabel = camera.link
    ? '🎨 Show invite QR'
    : camera.status === 'opening'
      ? 'Connecting…'
      : '🎨 Invite a co-host'

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
        <button
          type="button"
          className="chip chip--wide"
          data-testid="add-input"
          onClick={() => setShowAdd(true)}
        >
          ＋ Add input
        </button>

        {screenNotice && (
          <p className="side-note" data-testid="screen-notice" role="alert">
            {screenNotice}
          </p>
        )}
        {cameras.notice && (
          <p className="side-note" data-testid="camera-notice" role="alert">
            {cameras.notice}
          </p>
        )}
        {media.notice && (
          <p className="side-note" data-testid="media-notice" role="alert">
            {media.notice}
          </p>
        )}
        {sources.length === 0 ? (
          <span className="side-empty" data-testid="feeds-empty">
            No inputs yet
          </span>
        ) : (
          <div className="feed-list">
            {sources.map((source) => (
              <FeedCard
                key={source.id}
                source={source}
                selected={selectedId === source.id}
                onSelect={onSelect}
                onRemove={removeInput}
              />
            ))}
          </div>
        )}
        <span className="side-hint">[ ] flip feeds</span>
      </section>

      <section className="side-group">
        <h2 className="side-title">Program</h2>
        <label className="field">
          <span className="field__label">Corner camera</span>
          <select
            className="field__select"
            data-testid="corner-select"
            value={cornerId ?? ''}
            onChange={(event) => onCornerChange(event.target.value || null)}
          >
            <option value="">None</option>
            {sources
              .filter((source) => source.id !== selectedId)
              .map((source) => (
                <option key={source.id} value={source.id}>
                  {source.label}
                </option>
              ))}
          </select>
        </label>
        <span className="side-hint">
          Shown bottom-right on air. Replays keep the live feed in the top-right.
        </span>
        {selectedMedia && <MediaTransport element={selectedMedia.element} />}
      </section>

      <section className="side-group">
        <h2 className="side-title">Audio</h2>
        <AudioControls {...audio} />
      </section>

      <section className="side-group">
        <h2 className="side-title">Replay</h2>
        <ReplayControls {...replay} />
        <span className="side-hint">R replay · L live</span>
      </section>

      <section className="side-group">
        <h2 className="side-title">Co-hosts</h2>
        <button
          type="button"
          className="chip chip--wide"
          data-testid="create-camera-link"
          disabled={camera.status === 'opening'}
          onClick={camera.link ? () => setShowQr(true) : camera.createLink}
        >
          {inviteLabel}
        </button>
        {camera.cohosts.length === 0 ? (
          <span className="side-empty" data-testid="cohosts-empty">
            No co-hosts connected
          </span>
        ) : (
          <ul className="cohost-list" data-testid="cohost-list">
            {camera.cohosts.map((cohost) => (
              <li key={cohost.id} className="cohost" data-testid={`cohost-${cohost.id}`}>
                <span className="cohost__name">{cohost.label}</span>
                {cohost.streaming && <span className="cohost__tag">camera</span>}
                <button
                  type="button"
                  className="cohost__drop"
                  aria-label={`Disconnect ${cohost.label}`}
                  data-testid={`cohost-disconnect-${cohost.id}`}
                  onClick={() => camera.disconnect(cohost.id)}
                >
                  ✕
                </button>
              </li>
            ))}
          </ul>
        )}
        <span className="side-hint">
          Invited co-hosts draw on the program from their phone; their strokes go on air with
          yours.
        </span>
        {camera.link && (
          <button type="button" className="chip" data-testid="camera-stop" onClick={camera.stop}>
            End co-host session
          </button>
        )}
        {camera.notice && (
          <p className="side-note" data-testid="camlink-notice" role="alert">
            {camera.notice}
          </p>
        )}
      </section>

      <section className="side-group">
        <h2 className="side-title">Broadcast</h2>
        {broadcast.status === 'live' ? (
          <>
            <span className="side-status" data-testid="broadcast-viewers">
              {broadcast.viewers === 1 ? '1 viewer' : `${broadcast.viewers} viewers`}
            </span>
            <div className="row">
              <button
                type="button"
                className="chip"
                data-testid="broadcast-qr"
                onClick={() => setShowWatchQr(true)}
              >
                Show QR
              </button>
              <button type="button" className="chip" data-testid="broadcast-stop" onClick={broadcast.stop}>
                Stop
              </button>
            </div>
          </>
        ) : (
          <button
            type="button"
            className="chip chip--wide"
            data-testid="broadcast-start"
            disabled={!canBroadcast || broadcast.status === 'opening'}
            onClick={broadcast.start}
          >
            {broadcast.status === 'opening' ? 'Connecting…' : 'Go live to viewers'}
          </button>
        )}
        {!canBroadcast && broadcast.status !== 'live' && (
          <span className="side-empty">Share a tab or open a video first</span>
        )}
        {broadcast.notice && (
          <p className="side-note" data-testid="broadcast-notice" role="alert">
            {broadcast.notice}
          </p>
        )}
      </section>

      <section className="side-group">
        <h2 className="side-title">Hardware</h2>
        <span className="side-status" data-testid="hardware-gamepads">
          {hardware.gamepads.length === 0
            ? 'No gamepad detected'
            : `Gamepad: ${hardware.gamepads.join(', ')}`}
        </span>
        {hardware.midi === 'unsupported' ? (
          <span className="side-empty">MIDI isn’t available in this browser</span>
        ) : hardware.midi === 'on' ? (
          <span className="side-status" data-testid="hardware-midi">
            MIDI connected
          </span>
        ) : (
          <button
            type="button"
            className="chip"
            data-testid="hardware-midi-enable"
            onClick={() => void hardware.enableMidi()}
          >
            {hardware.midi === 'denied' ? 'MIDI blocked — try again' : 'Enable MIDI'}
          </button>
        )}
        <span className="side-hint">{HARDWARE_HINT}</span>
      </section>

      {showAdd && (
        <AddInputModal
          screenStatus={screenStatus}
          onToggleScreen={onToggleScreen}
          cameras={cameras}
          media={media}
          onClose={() => setShowAdd(false)}
        />
      )}

      {showQr && camera.link && (
        <QrModal
          title="Co-host invite link"
          url={camera.link}
          qr={qr}
          onClose={() => setShowQr(false)}
        />
      )}

      {showWatchQr && broadcast.link && (
        <QrModal
          title="Viewer link"
          url={broadcast.link}
          qr={viewerQr}
          onClose={() => setShowWatchQr(false)}
        />
      )}
    </aside>
  )
}

/**
 * A single input row: a small live thumbnail, its label, and — for an input the
 * host can stop from here — a ✕. The row itself is the pick target; the ✕ is a
 * sibling rather than a nested button, which HTML would not allow.
 */
function FeedCard({
  source,
  selected,
  onSelect,
  onRemove,
}: {
  source: StageSource
  selected: boolean
  onSelect: (id: string) => void
  onRemove: (source: StageSource) => void
}) {
  const removable = sourceRemoval(source) !== null
  return (
    <div className={`feed-card ${selected ? 'feed-card--on' : ''}`} data-source-id={source.id}>
      <button
        type="button"
        aria-label={`Show ${source.label}`}
        aria-pressed={selected}
        data-testid={`feed-${source.kind}`}
        className="feed-card__pick"
        onClick={() => onSelect(source.id)}
      >
        <FeedPreview src={source} />
        <span className="feed-card__label">{source.label}</span>
      </button>
      {removable && (
        <button
          type="button"
          className="feed-card__remove"
          aria-label={`Remove ${source.label}`}
          data-testid={`feed-remove-${source.id}`}
          onClick={() => onRemove(source)}
        >
          ✕
        </button>
      )}
    </div>
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
