import { useEffect, useRef, useState } from 'react'
import { PictureInPicture2, Plus, QrCode, Trash2, Undo2, X } from 'lucide-react'
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
import { ALL_TOOLS, COLORS, COLOR_LABELS, TOOL_LABELS, type Tool } from '../lib/telestration'
import {
  DEFAULT_PANEL,
  desktopPanels,
  panelBadge,
  type PanelBadge,
  type PanelId,
  type PanelSpec,
  type PanelStatus,
} from '../lib/panels'
import {
  canDraw,
  hint as modeHint,
  label as modeLabel,
  platformName,
  shortcutLabel,
  type ControlMode,
} from '../lib/controlMode'
import { PLATFORMS, STREAM_LABELS, destinationProblem, maskKey, platformFor, platformGroups } from '../lib/streamOut'
import type { StreamOutController } from '../lib/useStreamOut'
import { PANEL_ICONS, RAIL_STROKE, STREAM_ICON, TOOL_ICONS } from './icons'
import { AudioControls } from './AudioControls'
import { MediaTransport } from './MediaTransport'
import { ReplayControls } from './ReplayControls'
import { QrModal } from './QrModal'
import { AddInputModal } from './AddInputModal'

/** The stream-out presets under the headings the picker shows. The roster is static. */
const STREAM_GROUPS = platformGroups()

/**
 * The controls, on the right of the stage: a rail of every group and one panel
 * in front of it.
 *
 * The rail is always visible and carries each group's live state — how many
 * inputs are on the stage, who has joined the link, whether the program is on
 * air — so a closed panel is never a grey mystery. Its tiles are sized for a
 * stylus and a fingertip, and spread over the full height rather than clustering
 * at the top. Only one panel is open at a time, and it can be hidden entirely
 * for a clean picture while broadcasting. The program and the Go live / viewer
 * count sit pinned at the top of whichever panel is open, so the live actions
 * are never buried in a scroll.
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
  screenSupported,
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
  desktop,
  controlMode,
  mode,
  onMode,
  stream,
}: {
  tool: Tool
  setTool: (tool: Tool) => void
  color: string
  setColor: (color: string) => void
  canUndo: boolean
  onUndo: () => void
  onClear: () => void
  screenStatus: CaptureStatus
  /** Whether the platform has a screen/tab picker — a phone's webview has none. */
  screenSupported: boolean
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
  /** Whether the desktop shell is hosting us: it brings stream-out and a tray. */
  desktop: boolean
  /** Whether Control mode exists here: a phone has no second window to click
   * through to, so the tile is not offered on one. */
  controlMode: boolean
  mode: ControlMode
  onMode: (mode: ControlMode) => void
  stream: StreamOutController
}) {
  // The QR dialog opens as soon as a cameraman link is minted, and can be
  // reopened from the panel later.
  const [showQr, setShowQr] = useState(false)
  const [showWatchQr, setShowWatchQr] = useState(false)
  const [showAdd, setShowAdd] = useState(false)
  // Which group's panel is open. Clicking the open group's rail tile closes it,
  // leaving the rail — the distraction-free picture while on air.
  const [panel, setPanel] = useState<PanelId | null>(DEFAULT_PANEL)
  const viewerQr = useQrCode(broadcast.link)
  useEffect(() => {
    if (camera.link) setShowQr(true)
  }, [camera.link])

  // A co-host arriving opens the Co-hosts panel: someone has just joined the
  // link, and the host should see who without hunting for the rail tile. Only
  // ever on an arrival, never on mount or on a disconnection.
  const cohostCount = camera.cohosts.length
  const seenCohosts = useRef(cohostCount)
  useEffect(() => {
    if (cohostCount > seenCohosts.current) setPanel('cohosts')
    seenCohosts.current = cohostCount
  }, [cohostCount])

  // The transport only makes sense for an opened file or stream.
  const selectedMedia = media.feeds.find((feed) => feed.id === selectedId) ?? null

  // What is on the program right now: the pinned strip at the top of the panel.
  const onAir = sources.find((source) => source.id === selectedId) ?? null
  const live = broadcast.status === 'live'
  const opening = broadcast.status === 'opening'

  /** Stop one input from the list: the screen, one of the host's cameras, or a
   * opened file/stream. A co-host's camera is not removable here. */
  const removeInput = (source: StageSource) => {
    const removal = sourceRemoval(source)
    if (!removal) return
    if (removal.by === 'screen') onToggleScreen()
    else if (removal.by === 'camera') cameras.stop(removal.deviceId)
    else media.stop(removal.id)
  }

  const status: PanelStatus = {
    inputs: sources.length,
    mic: audio.micStatus,
    replaying: replay.replaying,
    cohosts: cohostCount,
    broadcasting: broadcast.status,
    viewers: broadcast.viewers,
    gamepads: hardware.gamepads.length,
    mode,
  }

  const panels = desktopPanels(controlMode)
  const active = panels.find((item) => item.id === panel) ?? null

  // The shortcut the shell actually registered on this platform.
  const shortcut = shortcutLabel(platformName())

  const streamPlatform = platformFor(stream.destination.address)
  const streamProblem = destinationProblem(stream.destination.address, stream.destination.key)

  const inviteLabel = camera.link
    ? 'Show invite QR'
    : camera.status === 'opening'
      ? 'Connecting…'
      : 'Invite a co-host'

  const togglePanel = (id: PanelId) => setPanel((current) => (current === id ? null : id))
  const mainPanels = panels.filter((item) => !item.utility)
  const utilityPanels = panels.filter((item) => item.utility)

  return (
    <aside className="sidebar" data-testid="sidebar" aria-label="Controls">
      {active && (
        <section className="panel" id="workbench-panel" data-testid="panel" aria-label={active.label}>
          {/* Pinned above the panel's own controls in every group: what is on
              the program, and the one live action that belongs to no group. */}
          <div className="panel__top">
            <span
              className={`panel__dot ${live ? 'panel__dot--live' : ''}`}
              aria-hidden="true"
            />
            <button
              type="button"
              className="panel__onair"
              data-testid="onair-program"
              title="Show the input panel"
              onClick={() => setPanel('input')}
            >
              {onAir ? onAir.label : 'Nothing on air'}
            </button>
            {live ? (
              <span className="panel__count" data-testid="broadcast-viewers">
                {broadcast.viewers === 1 ? '1 viewer' : `${broadcast.viewers} viewers`}
              </span>
            ) : (
              <button
                type="button"
                className="chip chip--live"
                data-testid="broadcast-start"
                disabled={!canBroadcast || opening}
                onClick={broadcast.start}
              >
                {opening ? 'Connecting…' : 'Go live'}
              </button>
            )}
          </div>

          <header className="panel__head">
            <h2 className="panel__title">{active.label}</h2>
            <button
              type="button"
              className="panel__hide"
              data-testid="panel-hide"
              aria-label="Hide the panel"
              title="Hide the panel"
              onClick={() => setPanel(null)}
            >
              <X aria-hidden="true" />
            </button>
          </header>

          <div className="panel__body">
            {active.id === 'control' && (
              <>
                {/* The switch itself. Draw is the default and the reason the
                    app exists, so it is first and reads as selected. */}
                <div className="opt-group">
                  <button
                    type="button"
                    className={`opt-row ${canDraw(mode) ? 'opt-row--on' : ''}`}
                    data-testid="control-draw"
                    onClick={() => onMode('draw')}
                  >
                    <TOOL_ICONS.pen className="opt-row__icon" aria-hidden="true" />
                    <span className="opt-row__label">Draw</span>
                  </button>
                  <button
                    type="button"
                    className={`opt-row ${canDraw(mode) ? '' : 'opt-row--on'}`}
                    data-testid="control-pass-through"
                    onClick={() => onMode('control')}
                  >
                    <PANEL_ICONS.control className="opt-row__icon" aria-hidden="true" />
                    <span className="opt-row__label">Control</span>
                  </button>
                </div>

                <span className="side-status" data-testid="control-mode">
                  {modeLabel(mode)}
                </span>
                <span className="side-hint">{modeHint(mode)}</span>
                <span className="side-hint">
                  A window that ignores the pointer cannot be clicked, so use {shortcut} or the
                  tray icon to come back.
                </span>
              </>
            )}

            {active.id === 'draw' && (
              <>
                {/* One stacked rail of options: every choice is a row the full
                    width of the panel, so a finger, a mouse or a pen lands on
                    the one it aimed at instead of between two small tiles. */}
                <div className="opt-group">
                  {ALL_TOOLS.map((item, index) => {
                    const ToolIcon = TOOL_ICONS[item]
                    return (
                      <button
                        key={item}
                        type="button"
                        aria-label={`Select the ${TOOL_LABELS[item].toLowerCase()} tool`}
                        aria-pressed={tool === item}
                        data-testid={`sidebar-tool-${item}`}
                        className={`opt-row ${tool === item ? 'opt-row--on' : ''}`}
                        onClick={() => setTool(item)}
                      >
                        <ToolIcon className="opt-row__icon" aria-hidden="true" />
                        <span className="opt-row__label">{TOOL_LABELS[item]}</span>
                        <span className="key-hint">{index + 1}</span>
                      </button>
                    )
                  })}
                </div>

                <div className="opt-group opt-group--split">
                  {COLORS.map((swatch) => (
                    <button
                      key={swatch}
                      type="button"
                      aria-label={`Select ${COLOR_LABELS[swatch].toLowerCase()}`}
                      aria-pressed={color === swatch}
                      data-testid={`sidebar-colour-${swatch}`}
                      className={`opt-row ${color === swatch ? 'opt-row--on' : ''}`}
                      onClick={() => setColor(swatch)}
                    >
                      <span
                        className="opt-row__swatch"
                        style={{ background: swatch }}
                        aria-hidden="true"
                      />
                      <span className="opt-row__label">{COLOR_LABELS[swatch]}</span>
                    </button>
                  ))}
                  <span className="side-hint">C and X cycle the colours</span>
                </div>

                <div className="opt-group opt-group--split">
                  <button
                    type="button"
                    className="opt-row"
                    data-testid="sidebar-undo"
                    onClick={onUndo}
                    disabled={!canUndo}
                    title="Undo last stroke"
                  >
                    <Undo2 className="opt-row__icon" aria-hidden="true" />
                    <span className="opt-row__label">Undo</span>
                    <span className="key-hint">Z</span>
                  </button>
                  <button
                    type="button"
                    className="opt-row"
                    data-testid="sidebar-clear"
                    onClick={onClear}
                    disabled={!canUndo}
                    title="Clear all strokes"
                  >
                    <Trash2 className="opt-row__icon" aria-hidden="true" />
                    <span className="opt-row__label">Clear</span>
                    <span className="key-hint">Del</span>
                  </button>
                </div>

                <span className="side-hint">
                  Strokes go on air with the picture. A co-host can draw on the same program.
                </span>
              </>
            )}

            {active.id === 'input' && (
              <>
                <button
                  type="button"
                  className="chip chip--wide"
                  data-testid="add-input"
                  onClick={() => setShowAdd(true)}
                >
                  <Plus aria-hidden="true" />
                  Add input
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
                <span className="side-hint">Tap an input to put it on the program · [ ] flip feeds</span>
                {selectedMedia && <MediaTransport element={selectedMedia.element} />}

                {/* The program's picture-in-picture. It belongs to what is on
                    the inputs, so it is the last row here rather than a panel
                    of its own. */}
                <label className="field field--split">
                  <span className="field__label">
                    <PictureInPicture2 aria-hidden="true" />
                    Corner camera
                  </span>
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
                  The corner camera is the picture-in-picture: bottom-right on air, with a replay
                  keeping the live feed in the top-right.
                </span>
              </>
            )}

            {active.id === 'audio' && <AudioControls {...audio} />}

            {active.id === 'replay' && (
              <>
                <ReplayControls {...replay} />
                <span className="side-hint">R replay · L live</span>
              </>
            )}

            {active.id === 'cohosts' && (
              <>
                <button
                  type="button"
                  className="chip chip--wide"
                  data-testid="create-camera-link"
                  disabled={camera.status === 'opening'}
                  onClick={camera.link ? () => setShowQr(true) : camera.createLink}
                >
                  <QrCode aria-hidden="true" />
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
                          <X aria-hidden="true" />
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                <span className="side-hint">
                  Invited co-hosts draw on the program from their phone; their strokes go on air
                  with yours.
                </span>
                {camera.link && (
                  <button
                    type="button"
                    className="chip"
                    data-testid="camera-stop"
                    onClick={camera.stop}
                  >
                    End co-host session
                  </button>
                )}
                {camera.notice && (
                  <p className="side-note" data-testid="camlink-notice" role="alert">
                    {camera.notice}
                  </p>
                )}
              </>
            )}

            {active.id === 'broadcast' && (
              <>
                {live ? (
                  <>
                    <span className="side-status">You are live</span>
                    <div className="row">
                      <button
                        type="button"
                        className="chip"
                        data-testid="broadcast-qr"
                        onClick={() => setShowWatchQr(true)}
                      >
                        Show viewer QR
                      </button>
                      <button
                        type="button"
                        className="chip"
                        data-testid="broadcast-stop"
                        onClick={broadcast.stop}
                      >
                        Stop
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    <span className="side-status">
                      {canBroadcast ? 'Ready to go live' : 'Nothing to broadcast yet'}
                    </span>
                    {!canBroadcast && (
                      <span className="side-empty">Share a tab or open a video first</span>
                    )}
                  </>
                )}
                {broadcast.notice && (
                  <p className="side-note" data-testid="broadcast-notice" role="alert">
                    {broadcast.notice}
                  </p>
                )}
                <span className="side-hint">
                  Viewers join at the live edge; the invite link is minted when you go live.
                </span>

                {desktop && (
                  <div className="stream-out">
                    <span className="stream-out__title">
                      <STREAM_ICON aria-hidden="true" />
                      Stream out
                    </span>

                    <label className="field field--split">
                      <span className="field__label">Platform</span>
                      <select
                        className="field__select"
                        data-testid="stream-platform"
                        value={streamPlatform?.id ?? 'custom'}
                        onChange={(event) => {
                          const chosen = PLATFORMS.find((item) => item.id === event.target.value)
                          if (chosen) stream.setDestination({ ...stream.destination, address: chosen.address })
                        }}
                      >
                        {STREAM_GROUPS.map((entry) => (
                          <optgroup key={entry.group} label={entry.group}>
                            {entry.platforms.map((platform) => (
                              <option key={platform.id} value={platform.id}>
                                {platform.label}
                              </option>
                            ))}
                          </optgroup>
                        ))}
                      </select>
                    </label>

                    <label className="field">
                      <span className="field__label">Ingest address</span>
                      <input
                        className="field__input"
                        data-testid="stream-address"
                        type="text"
                        spellCheck={false}
                        placeholder="rtmp://a.rtmp.youtube.com/live2"
                        value={stream.destination.address}
                        onChange={(event) =>
                          stream.setDestination({ ...stream.destination, address: event.target.value })
                        }
                      />
                    </label>

                    <label className="field">
                      <span className="field__label">Stream key</span>
                      <input
                        className="field__input"
                        data-testid="stream-key"
                        type="password"
                        spellCheck={false}
                        autoComplete="off"
                        placeholder={streamPlatform?.keyName ?? 'Stream key'}
                        value={stream.destination.key}
                        onChange={(event) =>
                          stream.setDestination({ ...stream.destination, key: event.target.value })
                        }
                      />
                    </label>

                    {stream.state === 'live' ? (
                      <button
                        type="button"
                        className="chip chip--wide"
                        data-testid="stream-stop"
                        onClick={() => void stream.stop()}
                      >
                        Stop streaming out
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="chip chip--live"
                        data-testid="stream-start"
                        disabled={streamProblem !== null || stream.state === 'connecting'}
                        onClick={() => void stream.start()}
                      >
                        {stream.state === 'connecting' ? 'Connecting…' : 'Stream out'}
                      </button>
                    )}

                    <span className="side-status" data-testid="stream-status">
                      {STREAM_LABELS[stream.state]}
                      {stream.destination.key ? ` · key ${maskKey(stream.destination.key)}` : ''}
                    </span>

                    {streamProblem && stream.state !== 'live' && (
                      <span className="side-empty" data-testid="stream-problem">
                        {streamProblem}
                      </span>
                    )}
                    {stream.failure && (
                      <p className="side-note" data-testid="stream-failure" role="alert">
                        {stream.failure}
                      </p>
                    )}
                    {stream.warning && (
                      <p className="side-note" data-testid="stream-warning" role="alert">
                        {stream.warning}
                      </p>
                    )}
                    <span className="side-hint">
                      The program goes straight to the platform — drawings, corners and all. The
                      key is kept in this window only.
                    </span>
                  </div>
                )}
              </>
            )}

            {active.id === 'hardware' && (
              <>
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
              </>
            )}
          </div>
        </section>
      )}

      {/* The rail: one tile per group, always on screen, spread over the full
          height. The utilities sit together at the base, past the divider. */}
      <nav className="rail" aria-label="Panels">
        <div className="rail__main">
          {mainPanels.map((item) => (
            <RailTile
              key={item.id}
              spec={item}
              badge={panelBadge(item.id, status)}
              open={active?.id === item.id}
              onToggle={() => togglePanel(item.id)}
            />
          ))}
        </div>
        <div className="rail__util">
          <span className="rail__split" aria-hidden="true" />
          {utilityPanels.map((item) => (
            <RailTile
              key={item.id}
              spec={item}
              badge={panelBadge(item.id, status)}
              open={active?.id === item.id}
              onToggle={() => togglePanel(item.id)}
            />
          ))}
        </div>
      </nav>

      {showAdd && (
        <AddInputModal
          screenStatus={screenStatus}
          screenSupported={screenSupported}
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
 * One tile on the rail: an outline glyph, its name, and the panel's live badge
 * when it has something to report. Clicking the open panel's tile closes it,
 * which is what hides the panel for a clean picture.
 */
function RailTile({
  spec,
  badge,
  open,
  onToggle,
}: {
  spec: PanelSpec
  badge: PanelBadge | null
  open: boolean
  onToggle: () => void
}) {
  const Icon = PANEL_ICONS[spec.id]
  return (
    <button
      type="button"
      className={`rail__item ${open ? 'rail__item--on' : ''}`}
      data-testid={`panel-tab-${spec.id}`}
      aria-expanded={open}
      aria-controls="workbench-panel"
      onClick={onToggle}
    >
      <Icon className="rail__icon" strokeWidth={RAIL_STROKE} aria-hidden="true" />
      <span className="rail__label">{spec.label}</span>
      {badge && (
        <span
          className={`rail__badge rail__badge--${badge.tone}`}
          data-testid={`panel-badge-${spec.id}`}
        >
          {badge.text}
        </span>
      )}
    </button>
  )
}

/**
 * A single input row: a small live thumbnail, its label, and — for an input the
 * host can stop from here — a close button. The row itself is the pick target;
 * the close button is a sibling rather than a nested button, which HTML would
 * not allow.
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
          <X aria-hidden="true" />
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
