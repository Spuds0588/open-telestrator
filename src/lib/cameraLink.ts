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

export interface CameraSession {
  /** The host PeerJS id the cameraman must call. */
  hostId: string
  /** Per-session secret the host verifies before answering. */
  token: string
}

/** A fresh, unguessable per-session token. */
export function createToken(): string {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

/**
 * Build the cameraman link from the host page's own URL. Resolving against the
 * document's directory (not the origin root) keeps the link inside the app when
 * the front end is served from a sub-path, e.g. GitHub Pages /open-telestrator/.
 */
export function buildCameraLink(baseHref: string, session: CameraSession): string {
  const url = new URL('.', baseHref)
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
