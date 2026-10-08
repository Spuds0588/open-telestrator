import { useEffect, useState } from 'react'
import { Camera, FileVideo, Link2, MonitorUp, Smartphone } from 'lucide-react'
import type { CaptureStatus } from '../lib/capture'
import type { HostCameras } from '../lib/useHostCameras'
import type { HostCamera } from '../lib/useHostCamera'
import type { MediaFeeds } from '../lib/useMediaFeeds'

/**
 * The picker behind **Add input**.
 *
 * The Input group holds no controls of its own any more: one button opens this
 * dialog, the host picks what they are adding, and the chosen input's preview
 * appears in the list behind it. Each pick performs the action and closes, so
 * the modal is a single step — the browser's own tab picker or file dialog does
 * the rest.
 *
 * A phone on the other end is one of those inputs, and it is listed here because
 * this is where a host looks for a camera. It opens the same session the Co-hosts
 * group mints — one peer, one token — through the **camera** door: the phone sends
 * its camera and microphone and is offered no drawing surface. Drawing is the
 * host's; a person who is invited to draw comes in through the Co-hosts group.
 */
export function AddInputModal({
  screenStatus,
  screenSupported,
  onToggleScreen,
  cameras,
  media,
  camera,
  onInviteCamera,
  onClose,
}: {
  screenStatus: CaptureStatus
  /**
   * Whether this platform has a screen/tab picker. A phone has no
   * `getDisplayMedia`, so the row is not drawn there at all rather than offered
   * and refused.
   */
  screenSupported: boolean
  /** Start or stop the shared tab/screen capture. */
  onToggleScreen: () => void
  cameras: HostCameras
  media: MediaFeeds
  camera: HostCamera
  /**
   * Mint this session's camera link, or show its QR again — the camera door of
   * the one link the Co-hosts group also hands out.
   */
  onInviteCamera: () => void
  onClose: () => void
}) {
  const [url, setUrl] = useState('')

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  const sharing = screenStatus === 'live'
  const requesting = screenStatus === 'requesting'

  return (
    <div
      className="modal"
      data-testid="add-input-modal"
      role="dialog"
      aria-modal="true"
      aria-label="Add an input"
      onClick={onClose}
    >
      <div className="modal__panel" onClick={(event) => event.stopPropagation()}>
        <h2 className="modal__title">Add an input</h2>

        <div className="picker">
          {screenSupported && (
            <button
              type="button"
              className={`picker__row ${sharing ? 'picker__row--on' : ''}`}
              data-testid="add-input-screen"
              aria-busy={requesting}
              disabled={requesting}
              onClick={() => {
                onToggleScreen()
                onClose()
              }}
            >
              <span className="picker__icon" aria-hidden="true">
                <MonitorUp />
              </span>
              <span className="picker__text">
                <strong>{sharing ? 'Stop sharing' : requesting ? 'Waiting…' : 'Share a tab or screen'}</strong>
                <span className="picker__sub">
                  {sharing ? 'The captured tab is in the list' : 'A game, a stream — anything on a tab'}
                </span>
              </span>
            </button>
          )}

          {/* A camera, not a co-host: the phone sends a picture and a microphone
              and nothing comes back its way. */}
          <button
            type="button"
            className={`picker__row ${camera.link ? 'picker__row--on' : ''}`}
            data-testid="add-input-phone-camera"
            aria-busy={camera.status === 'opening'}
            disabled={camera.status === 'opening'}
            onClick={() => {
              onInviteCamera()
              onClose()
            }}
          >
            <span className="picker__icon" aria-hidden="true">
              <Smartphone />
            </span>
            <span className="picker__text">
              <strong>
                {camera.status === 'opening'
                  ? 'Opening…'
                  : camera.link
                    ? 'Phone camera — link ready'
                    : 'Add a phone camera'}
              </strong>
              <span className="picker__sub">
                {camera.link
                  ? 'Tap for the QR and the link'
                  : 'Another phone sends its camera and microphone'}
              </span>
            </span>
          </button>

          {cameras.devices.length === 0 ? (
            <span className="picker__empty" data-testid="add-input-no-cameras">
              No cameras found
            </span>
          ) : (
            cameras.devices.map((device) => {
              const live = cameras.sources.some((source) => source.id === `cam:${device.id}`)
              const opening = cameras.busy === device.id
              return (
                <button
                  key={device.id}
                  type="button"
                  className={`picker__row ${live ? 'picker__row--on' : ''}`}
                  data-testid={`add-input-camera-${device.id}`}
                  aria-pressed={live}
                  aria-busy={opening}
                  disabled={opening}
                  onClick={() => {
                    if (live) cameras.stop(device.id)
                    else void cameras.start(device.id)
                    onClose()
                  }}
                >
                  <span className="picker__icon" aria-hidden="true">
                    <Camera />
                  </span>
                  <span className="picker__text">
                    <strong>{opening ? 'Opening…' : device.label}</strong>
                    <span className="picker__sub">{live ? 'Running — tap to stop' : 'Camera'}</span>
                  </span>
                </button>
              )
            })
          )}

          <label className="picker__row" data-testid="add-input-file">
            <span className="picker__icon" aria-hidden="true">
              <FileVideo />
            </span>
            <span className="picker__text">
              <strong>Open a video file</strong>
              <span className="picker__sub">Anything the browser can play</span>
            </span>
            <input
              type="file"
              accept="video/*"
              data-testid="media-file-input"
              className="visually-hidden"
              onChange={(event) => {
                const file = event.target.files?.[0]
                if (file) media.openFile(file)
                // Allow picking the same file again after stopping it.
                event.target.value = ''
                onClose()
              }}
            />
          </label>

          <form
            className="picker__row picker__row--url"
            data-testid="add-input-url"
            onSubmit={(event) => {
              event.preventDefault()
              const link = url.trim()
              if (!link) return
              media.openUrl(link)
              onClose()
            }}
          >
            <span className="picker__icon" aria-hidden="true">
              <Link2 />
            </span>
            <span className="picker__text">
              <strong>Open a stream URL</strong>
              <span className="picker__sub">HLS (.m3u8) or a plain MP4/WebM link</span>
            </span>
            <div className="picker__url">
              <input
                type="url"
                className="link-input"
                placeholder="https://…/stream.m3u8"
                aria-label="Stream URL"
                data-testid="media-url"
                value={url}
                onChange={(event) => setUrl(event.target.value)}
              />
              <button type="submit" className="chip" data-testid="media-open-url" disabled={media.busy}>
                {media.busy ? 'Opening…' : 'Add'}
              </button>
            </div>
          </form>
        </div>

        <button type="button" className="btn btn--ghost" data-testid="add-input-cancel" onClick={onClose}>
          Cancel
        </button>
      </div>
    </div>
  )
}
