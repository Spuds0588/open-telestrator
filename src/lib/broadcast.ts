/**
 * Viewer broadcast protocol (PeerJS tree distribution).
 *
 * The host is the root of a tree. A viewer joins over a data channel to the
 * host, the host picks it a parent (itself or another viewer that still has
 * space), and that parent calls the viewer with the live program stream. Every
 * viewer therefore also relays: it hands the stream it receives to the viewers
 * placed under it.
 *
 * There is deliberately no catch-up, buffering or synchronisation: a late
 * joiner only ever gets the frames that arrive after it connects, and viewers
 * drift independently. The goal is a steady live picture per viewer, not a
 * shared timeline.
 */

/** Query parameter holding the host's PeerJS id. Marks the viewer page. */
export const WATCH_PARAM = 'watch'

/**
 * Query parameter that answers the embed question outright, for pages that
 * want to be sure: any value but `0`/`false` asks for the bare layout, and
 * `0`/`false` keeps the viewer page even inside a frame.
 */
export const EMBED_PARAM = 'embed'

/** The origin of an absolute URL, or null when it cannot be read. */
function originOf(href: string): string | null {
  try {
    return new URL(href).origin
  } catch {
    return null
  }
}

export type EmbedSignals = {
  /** The viewer page's own address. */
  href: string
  /** True when this document sits inside a frame or object element. */
  framed: boolean
  /** Where the browser says the page was linked from; often empty. */
  referrer: string
}

/**
 * Whether the viewer page should render as an embed: the picture and its
 * controls, without this app's own chrome around them.
 *
 * `embed` in the link answers explicitly either way. Without it the page reads
 * its surroundings: a document inside a frame, or linked from another origin,
 * is part of someone else's page, so it goes bare. Our own pages — and a link
 * opened by hand — keep the full viewer.
 */
export function wantsEmbed({ href, framed, referrer }: EmbedSignals): boolean {
  let url: URL | null = null
  try {
    url = new URL(href)
  } catch {
    url = null
  }

  const asked = url?.searchParams.get(EMBED_PARAM) ?? null
  if (asked !== null) return asked !== '0' && asked !== 'false'

  if (framed) return true

  const from = originOf(referrer)
  return from !== null && url !== null && from !== url.origin
}

/** Viewer children a single node (host or relay) will accept. */
export const MAX_CHILDREN = 2

/** How often the host checks its viewers for liveness. */
export const SWEEP_MS = 2000

/**
 * How long a handoff reservation stays valid. A reservation exists only to stop
 * two viewers joining at once from being offered the same free slot, so once it
 * ages out the parent's reported child count is trusted instead.
 */
export const RESERVATION_MS = 10_000

/**
 * How long the host tolerates silence from a viewer. Generous on purpose: a
 * backgrounded tab has its timers throttled, and dropping a live relay by
 * mistake costs more than keeping a dead one for a few extra seconds.
 */
export const STALE_VIEWER_MS = 60_000

/** How often a viewer re-reports its child count, doubling as a heartbeat. */
export const HEARTBEAT_MS = 3000

/**
 * Seconds without a single decoded frame before a viewer treats its parent as
 * gone and rejoins through the host. Deliberately slack: a quiet picture
 * legitimately decodes few frames, and an unnecessary rejoin costs a small
 * interruption, while a missed one leaves a frozen picture on screen.
 */
export const STALL_TICKS = 6

/** Consecutive failed rejoins before a viewer gives up and says so. */
export const MAX_REJOIN_ATTEMPTS = 6

/** Transport states that mean a viewer can no longer be reached. */
export function isTransportDead(state: RTCPeerConnectionState | undefined): boolean {
  return state === 'failed' || state === 'closed' || state === 'disconnected'
}

/**
 * Whether a viewer should be dropped from the tree. Either its transport is
 * gone, or it has said nothing for so long that it is not coming back. A viewer
 * we have not heard from yet is kept: it may simply still be connecting.
 */
export function isViewerGone(
  transport: RTCPeerConnectionState | undefined,
  lastSeen: number | undefined,
  now: number,
): boolean {
  if (isTransportDead(transport)) return true
  return lastSeen !== undefined && now - lastSeen > STALE_VIEWER_MS
}

/** Whether a handoff reservation has aged out and should stop holding a slot. */
export function isReservationStale(reservedAt: number, now: number): boolean {
  return now - reservedAt > RESERVATION_MS
}

export interface ViewerSession {
  /** The host PeerJS id every viewer joins through. */
  hostId: string
  /** Per-session secret checked on join and on every stream request. */
  token: string
}

/**
 * Build the viewer link from the host page's own URL (sub-path safe). The viewer
 * entry lives on the studio page (`app.html`), never on the landing page that
 * owns the base address.
 */
export function buildViewerLink(baseHref: string, session: ViewerSession): string {
  const url = new URL('app.html', baseHref)
  url.searchParams.set(WATCH_PARAM, session.hostId)
  url.searchParams.set('t', session.token)
  return url.toString()
}

/** Reads a viewer session out of a URL, or null when this isn't a viewer link. */
export function parseViewerLink(href: string): ViewerSession | null {
  let url: URL
  try {
    url = new URL(href)
  } catch {
    return null
  }
  const hostId = url.searchParams.get(WATCH_PARAM)
  const token = url.searchParams.get('t')
  if (!hostId || !token) return null
  return { hostId, token }
}

/**
 * Messages on a viewer's data channel:
 *
 * - `join`   viewer → host: request a place in the tree.
 * - `parent` host → viewer: the peer to get the stream from.
 * - `feed`   viewer → parent: send me the stream.
 * - `relay`  node → host: how many viewers I am currently feeding.
 * - `full`   host → viewer: no node has space right now.
 */
export type BroadcastMessage =
  | { t: 'join'; token: string }
  | { t: 'parent'; parentId: string }
  | { t: 'feed'; token: string }
  | { t: 'relay'; children: number }
  | { t: 'full' }

/** Validates an untrusted data-channel payload into a known message. */
export function parseBroadcastMessage(raw: unknown): BroadcastMessage | null {
  if (typeof raw !== 'object' || raw === null) return null
  const message = raw as Record<string, unknown>
  switch (message.t) {
    case 'join':
    case 'feed':
      return typeof message.token === 'string' && message.token.length > 0
        ? { t: message.t, token: message.token }
        : null
    case 'parent':
      return typeof message.parentId === 'string' && message.parentId.length > 0
        ? { t: 'parent', parentId: message.parentId }
        : null
    case 'relay': {
      const children = message.children
      if (typeof children !== 'number' || !Number.isFinite(children) || children < 0) return null
      return { t: 'relay', children }
    }
    case 'full':
      return { t: 'full' }
    default:
      return null
  }
}

/** A node that could take another child, with its free slots. */
export interface Candidate {
  id: string
  free: number
}

/**
 * Pick where a new viewer should attach: the node with the most free slots,
 * with the host first winning ties so the tree stays shallow. Returns null when
 * every node is full.
 */
export function chooseParent(candidates: readonly Candidate[]): string | null {
  let best: Candidate | null = null
  for (const candidate of candidates) {
    if (candidate.free <= 0) continue
    if (!best || candidate.free > best.free) best = candidate
  }
  return best ? best.id : null
}

/**
 * The stream sent to viewers: the program's video track plus the mixed stage
 * audio, on a fresh MediaStream. Audio is optional — a viewer still gets the
 * picture when the host has no mic or captured audio.
 */
export function mixBroadcastStream(
  program: MediaStream | null,
  audio: MediaStream | null,
): MediaStream | null {
  const tracks: MediaStreamTrack[] = []
  const video = program?.getVideoTracks()[0]
  if (video) tracks.push(video)
  const sound = audio?.getAudioTracks()[0]
  if (sound) tracks.push(sound)
  return tracks.length > 0 ? new MediaStream(tracks) : null
}
