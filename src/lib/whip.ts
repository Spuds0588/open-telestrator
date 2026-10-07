/**
 * Streaming the program out over WebRTC, with no install of any kind.
 *
 * The studio used to send encoded frames to a native publisher over RTMP. That
 * needed a binary on the machine and a registration step, because a browser
 * cannot open an RTMP socket. This file is the replacement: **WHIP**, the
 * WebRTC-HTTP Ingestion Protocol, where publishing is one `POST` of an SDP offer
 * and the teardown is one `DELETE`. A browser is already a WebRTC encoder, so
 * there is nothing to install, no extension, no companion process, and no
 * encoder of our own — the composited `MediaStream` the P2P viewer already uses
 * is handed to a `RTCPeerConnection` and published as it is.
 *
 * What that trades away is reach. A platform's own ingest (YouTube, Twitch)
 * speaks RTMP, which a browser cannot dial, so every route here goes through a
 * service that accepts WebRTC and forwards. Three of them are supported, and
 * they are different shapes of the same idea:
 *
 * - **Restream** takes WHIP on its free plan and re-sends the stream to every
 *   platform connected to that account, converting to RTMP where needed. This is
 *   the one that reaches the platforms people already stream to.
 * - **Cloudflare Stream** takes WHIP and plays back over WHEP. Nothing is
 *   forwarded, so this is for owning the feed rather than for YouTube.
 * - **LiveKit** takes WHIP and can push out to YouTube, Twitch and Facebook over
 *   RTMP from an egress, but it is a deployment or an account of your own.
 *
 * Everything in this file is either a table or a pure function, so the parts
 * that decide whether a paste is usable and what a refusal means are testable
 * without a connection. `useStreamOut` owns the peer connection and the retries;
 * `whipPost` and `whipDelete` are the only two things here that touch the
 * network, and both take the `fetch` they should use.
 *
 * Protocol notes, from RFC 9725: the offer is posted as `Content-Type:
 * application/sdp`, the answer comes back in the body with a `Location` header
 * naming the resource to `DELETE` when the broadcast ends, and credentials — if
 * the endpoint wants any — travel as a bearer token. Trickle ICE is optional;
 * this waits for gathering to finish and posts one complete offer, which is one
 * request instead of a stream of them.
 */

/** The services this build knows how to publish to. */
export type WhipServiceId = 'restream' | 'cloudflare' | 'livekit'

export interface WhipService {
  id: WhipServiceId
  label: string
  /** What to paste, in the operator's words. */
  field: string
  /** Which tab or page in their dashboard the endpoint is on. */
  where: string
  /** The documentation to link to, when the paste is not where they expect. */
  docs: string
  /** Whether this endpoint usually carries a bearer token too. */
  token: boolean
  /** What happens to the picture after it arrives, in one sentence. */
  outcome: string
}

/**
 * The three routes, in the order they are offered: the one that reaches a
 * platform first, because that is what almost everybody wants.
 */
export const WHIP_SERVICES: readonly WhipService[] = [
  {
    id: 'restream',
    label: 'Restream',
    field: 'WHIP URL',
    where: 'your stream’s setup, on the WHIP tab',
    docs: 'https://support.restream.io/en/articles/11780279-how-to-stream-to-restream-using-whip',
    token: false,
    outcome:
      'Restream sends it on to every platform connected to your account, converting to RTMP where one needs it.',
  },
  {
    id: 'cloudflare',
    label: 'Cloudflare Stream',
    field: 'WebRTC publish URL',
    where: 'the live input’s WebRTC tab, as webRTC.url',
    docs: 'https://developers.cloudflare.com/stream/webrtc-beta/',
    token: false,
    outcome:
      'Cloudflare hosts the feed and viewers watch it there over WHEP. Nothing is forwarded to another platform.',
  },
  {
    id: 'livekit',
    label: 'LiveKit',
    field: 'Ingress endpoint URL',
    where: 'the ingress you created',
    docs: 'https://docs.livekit.io/transport/media/ingress-egress/ingress/',
    token: true,
    outcome:
      'LiveKit can push the stream on to YouTube, Twitch or Facebook from an egress in the same project.',
  },
]

export function serviceFor(id: string): WhipService | null {
  return WHIP_SERVICES.find((service) => service.id === id) ?? null
}

/** A chosen route: which service, where it is, and what it wants as a credential. */
export interface WhipDestination {
  service: WhipServiceId
  /**
   * The endpoint, pasted from the service's dashboard. It is a credential in its
   * own right for Restream and Cloudflare — the secret is part of the URL — so it
   * is treated as one: masked on screen, never logged.
   */
  url: string
  /** A bearer token, for an endpoint that wants one. Often empty. */
  token: string
}

export const DEFAULT_DESTINATION: WhipDestination = {
  service: 'restream',
  url: '',
  token: '',
}

/** How the stream-out is going, in the words the panel uses. */
export type StreamState = 'idle' | 'connecting' | 'live' | 'error'

export const STREAM_LABELS: Record<StreamState, string> = {
  idle: 'Not streaming out',
  connecting: 'Connecting…',
  live: 'Streaming out',
  error: 'Stream out stopped',
}

/** The tone the broadcast tile's badge should take, if any. */
export function streamTone(state: StreamState): 'live' | 'warn' | null {
  if (state === 'live') return 'live'
  if (state === 'error') return 'warn'
  return null
}

/**
 * What is wrong with the paste, as a sentence to show — or `null` when it looks
 * publishable.
 *
 * Deliberately shallow, as the RTMP form was: it catches what can be seen without
 * a round trip and leaves whether the endpoint exists to the service. An
 * `https://` endpoint is required rather than preferred: a page on GitHub Pages
 * is a secure context, and a plain `http://` publish URL would be blocked as
 * mixed content before it left the browser, so saying so here is kinder than
 * letting the browser say it.
 */
export function destinationProblem(destination: WhipDestination): string | null {
  const url = destination.url.trim()
  if (url === '') {
    return 'Paste the publish URL the service gave you — it is the address to send the program to.'
  }

  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return 'That is not a URL. Copy the whole publish address, including the https:// at the front.'
  }
  if (parsed.protocol !== 'https:') {
    return 'The publish URL has to start with https:// — a page served securely cannot send the program to a plain http:// address.'
  }
  if (parsed.pathname === '/' || parsed.pathname === '') {
    return 'That looks like the service’s home page rather than a publish URL. Copy the address for one broadcast.'
  }

  return null
}

/**
 * The key with only its last four characters showing.
 *
 * Both a Restream URL and a Cloudflare one carry their secret in the address, so
 * a whole destination should never be readable over a shoulder or in a
 * screenshot. Short values are shown as nothing but dots, because four
 * characters of a six-character one is most of it.
 */
export function maskSecret(secret: string): string {
  const trimmed = secret.trim()
  if (trimmed === '') return ''
  if (trimmed.length <= 8) return '••••••••'
  return `••••••••${trimmed.slice(-4)}`
}

/** The headers a publish request carries, including the token when there is one. */
export function publishHeaders(token: string): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/sdp' }
  const trimmed = token.trim()
  if (trimmed !== '') headers.Authorization = `Bearer ${trimmed}`
  return headers
}

/**
 * What a refusal means, in a sentence an operator can act on.
 *
 * Status codes are the only thing the service tells us plainly, so each one gets
 * the likeliest cause rather than the number: a person reading "405" learns
 * nothing, and a person reading "that address does not accept a broadcast" knows
 * they pasted the playback URL.
 */
export function publishProblem(status: number, detail: string): string {
  const extra = detail.trim().slice(0, 200)
  const because = extra === '' ? '' : ` The service said: ${extra}`
  switch (status) {
    case 400:
      return `The service refused the offer as malformed.${because}`
    case 401:
    case 403:
      return `The service refused the credential. Check the publish URL is the latest one, and paste the token if it uses one.${because}`
    case 404:
      return `There is nothing at that address. It may have been replaced by a new stream, or the URL may be incomplete.${because}`
    case 405:
      return `That address does not accept a broadcast — it looks like a playback or status URL rather than a publish one.${because}`
    case 409:
      return `Something is already publishing to that address. Stop the other broadcast first.${because}`
    case 415:
      return `The service would not accept an SDP offer.${because}`
    case 429:
      return `The service is rate-limiting this account. Wait a moment and try again.${because}`
    default:
      return status >= 500
        ? `The service had a problem on its side (${status}). Try again in a moment.${because}`
        : `The service refused the broadcast (${status}).${because}`
  }
}

/** A completed publication: the resource to hang up on, and the answer to apply. */
export interface WhipSession {
  answer: string
  /** The `Location` header, resolved. `null` when the service omitted it. */
  resource: string | null
}

/**
 * The service's `Location`, turned into something `DELETE` can use.
 *
 * The header may be absolute or relative to the endpoint, and RFC 9725 only
 * requires that it identify the resource. Resolving it here keeps the hook from
 * having to think about it.
 */
export function resolveResource(location: string | null, endpoint: string): string | null {
  if (!location) return null
  try {
    return new URL(location, endpoint).toString()
  } catch {
    return null
  }
}

/**
 * Publish one offer. The only network call that starts a broadcast.
 *
 * Takes the `fetch` to use so a test can hand it a stub; in the app it is the
 * browser's own.
 */
export async function whipPost(
  endpoint: string,
  offer: string,
  token: string,
  fetcher: typeof fetch = fetch,
): Promise<WhipSession | { problem: string }> {
  let response: Response
  try {
    response = await fetcher(endpoint, {
      method: 'POST',
      headers: publishHeaders(token),
      body: offer,
    })
  } catch (cause) {
    // A cross-origin refusal, a DNS failure and an offline browser all arrive
    // here as one opaque error, so the sentence names the likeliest cause and
    // does not pretend to know.
    return {
      problem: `Could not reach the service at all — this is usually the browser refusing a cross-origin request, or no connection. (${describe(cause)})`,
    }
  }

  if (!response.ok) {
    return { problem: publishProblem(response.status, await safeText(response)) }
  }

  let answer = ''
  try {
    answer = await response.text()
  } catch (cause) {
    return { problem: `The service answered but the body could not be read. (${describe(cause)})` }
  }
  if (answer.trim() === '') {
    return { problem: 'The service accepted the offer but sent back no answer, so there is nothing to apply.' }
  }
  return { answer, resource: resolveResource(response.headers.get('Location'), endpoint) }
}

/**
 * Tell the service the broadcast is over.
 *
 * Best effort, and never fatal: a `DELETE` that fails means the service will
 * time the broadcast out for itself, and the picture has already stopped. The
 * result is reported to nobody but the console.
 */
export async function whipDelete(resource: string | null, token: string, fetcher: typeof fetch = fetch): Promise<boolean> {
  if (!resource) return false
  try {
    const headers = publishHeaders(token)
    delete headers['Content-Type']
    const response = await fetcher(resource, { method: 'DELETE', headers })
    return response.ok
  } catch {
    return false
  }
}

/** A message from an unknown thrown value, for a sentence that has to contain one. */
function describe(cause: unknown): string {
  if (cause instanceof Error && cause.message) return cause.message
  return String(cause)
}

/** A response body for an error sentence, or nothing when it cannot be read. */
async function safeText(response: Response): Promise<string> {
  try {
    return await response.text()
  } catch {
    return ''
  }
}

/**
 * Whether a broadcast would go out silent.
 *
 * The program is a picture plus the audio mix; a browser can always encode Opus,
 * so unlike the RTMP path there is no codec to fall back from. What can still
 * happen is the operator having no audio selected at all, which is worth one
 * sentence rather than a stream nobody hears.
 */
export function silentWarning(hasAudio: boolean): string | null {
  return hasAudio
    ? null
    : 'Nothing is selected for audio, so this broadcast will be silent. Add a source with sound, or turn on the announcer mic.'
}

/** What to say when the peer connection itself gives up, with no HTTP status to go on. */
export function connectionProblem(state: RTCPeerConnectionState): string | null {
  switch (state) {
    case 'failed':
      return 'The connection to the service failed. The network may be blocking WebRTC, or the publish URL may have expired.'
    case 'disconnected':
      return 'The connection dropped. It may recover on its own; if it does not, stop and start again.'
    case 'closed':
      return 'The service closed the connection. The broadcast has ended.'
    default:
      return null
  }
}
