import type { PeerOptions } from 'peerjs'

/**
 * PeerJS signaling + ICE configuration, driven entirely by build-time env vars
 * so the app stays a static front end with no backend of its own.
 *
 * With nothing set, PeerJS's public broker and its built-in STUN are used — the
 * connection point is PeerJS, nothing else. A self-hosted broker or additional
 * STUN/TURN servers can be supplied by the operator without a code change, which
 * is what lets a cameraman on mobile data negotiate when plain STUN is not
 * enough. No server is bundled or required by this app.
 */
export function parseIceServers(raw: string | undefined): RTCIceServer[] {
  if (!raw) return []
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(
      (entry): entry is RTCIceServer =>
        typeof entry === 'object' && entry !== null && 'urls' in entry,
    )
  } catch {
    return []
  }
}

export function peerOptions(env: ImportMetaEnv = import.meta.env): PeerOptions {
  const options: PeerOptions = {}

  const host = env.VITE_PEER_HOST?.trim()
  if (host) {
    options.host = host
    options.port = Number(env.VITE_PEER_PORT) || 443
    options.path = env.VITE_PEER_PATH?.trim() || '/'
    options.secure = env.VITE_PEER_SECURE === 'true'
    const key = env.VITE_PEER_KEY?.trim()
    if (key) options.key = key
  }

  const iceServers = parseIceServers(env.VITE_ICE_SERVERS)
  if (iceServers.length > 0) options.config = { iceServers }

  return options
}
