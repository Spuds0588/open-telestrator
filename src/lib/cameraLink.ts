/**
 * Camera magic-link format.
 *
 * The link is the whole handshake: `?camera=<host peer id>&t=<session token>`.
 * It carries no server state, so it works from any static deployment. The host
 * peer id routes the cameraman to the right peer and the token is checked by the
 * host before it will answer a call, so a stale or guessed link cannot push
 * video onto the stage.
 */

/** Query parameter holding the host's PeerJS id. Also the cameraman page's marker. */
export const CAMERA_PARAM = 'camera'

/**
 * How often the host repeats the viewer count to its co-hosts. The media path
 * stays one-way — a cameraman never receives the program — so this number
 * travels on its own small data channel, and it is repeated rather than sent
 * only on change: one dropped message would otherwise leave a stale count on a
 * screen nobody is watching.
 */
export const VIEWERS_REPORT_MS = 3000

export interface CameraSession {
  /** The host PeerJS id the cameraman must call. */
  hostId: string
  /** Per-session secret the host verifies before answering. */
  token: string
}

/** What the host tells a co-host over the camera link's data channel. */
export interface CameraReport {
  t: 'viewers'
  /** Viewers currently being fed anywhere in the broadcast tree. */
  count: number
}

/** Builds the viewer count the host pushes to its co-hosts. */
export function viewersReport(count: number): CameraReport {
  return { t: 'viewers', count: count > 0 ? Math.floor(count) : 0 }
}

/** Validates an untrusted data-channel payload into a known report. */
export function parseCameraReport(raw: unknown): CameraReport | null {
  if (typeof raw !== 'object' || raw === null) return null
  const message = raw as Record<string, unknown>
  if (message.t !== 'viewers') return null
  const count = message.count
  if (typeof count !== 'number' || !Number.isFinite(count) || count < 0) return null
  return { t: 'viewers', count: Math.floor(count) }
}

/** A fresh, unguessable per-session token. */
export function createToken(): string {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

/**
 * Build the cameraman link from the host page's own URL. The cameraman entry
 * lives on the studio page (`app.html`), not the landing page at the directory
 * root; resolving it against the host URL keeps the link inside the app when the
 * front end is served from a sub-path, e.g. GitHub Pages /open-telestrator/.
 */
export function buildCameraLink(baseHref: string, session: CameraSession): string {
  const url = new URL('app.html', baseHref)
  url.searchParams.set(CAMERA_PARAM, session.hostId)
  url.searchParams.set('t', session.token)
  return url.toString()
}

/** Reads a session out of a URL, or null when this isn't a camera link. */
export function parseCameraLink(href: string): CameraSession | null {
  let url: URL
  try {
    url = new URL(href)
  } catch {
    return null
  }
  const hostId = url.searchParams.get(CAMERA_PARAM)
  const token = url.searchParams.get('t')
  if (!hostId || !token) return null
  return { hostId, token }
}
