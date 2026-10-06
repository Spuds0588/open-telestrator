/**
 * Sending the program out to an RTMP platform.
 *
 * This is the *form's* half of stream-out: what a destination looks like, which
 * platforms offer a plain address, deciding what to complain about before a
 * round trip, and never putting a stream key on screen or in a log. The other
 * half — parsing the address authoritatively and dialling it — lives in
 * `src-tauri/media`, because the shell is what actually connects and it must not
 * trust the webview for it. The two do not share code, so this file stays to
 * what the form needs rather than reimplementing the parser.
 *
 * A note on the platforms: only `rtmp://` is listed. The Rust publisher does not
 * speak `rtmps://` yet, and pointing someone at an address the build will refuse
 * is worse than not listing the platform at all. YouTube and Twitch both publish
 * a plain ingest address; Facebook Live does not, so Facebook is absent until
 * TLS lands.
 */

export interface Destination {
  address: string
  key: string
}

export interface Platform {
  id: string
  label: string
  /** Empty for "something else", which the user fills in. */
  address: string
  /** What the platform calls the key, for the field's placeholder. */
  keyName: string
}

export const PLATFORMS: readonly Platform[] = [
  {
    id: 'youtube',
    label: 'YouTube Live',
    address: 'rtmp://a.rtmp.youtube.com/live2',
    keyName: 'Stream key',
  },
  {
    id: 'twitch',
    label: 'Twitch',
    address: 'rtmp://live.twitch.tv/app',
    keyName: 'Stream key',
  },
  {
    id: 'custom',
    label: 'Something else',
    address: '',
    keyName: 'Stream key',
  },
]

/** The platform whose address matches, or null when it is one we do not know. */
export function platformFor(address: string): Platform | null {
  const trimmed = address.trim().toLowerCase()
  if (trimmed === '') return null
  return PLATFORMS.find((platform) => platform.address !== '' && platform.address === trimmed) ?? null
}

/** Whether the address already carries a stream name after the application. */
export function hasStreamName(address: string): boolean {
  const rest = address.trim().replace(/^rtmps?:\/\//i, '')
  const path = rest.includes('/') ? rest.slice(rest.indexOf('/') + 1) : ''
  return path.split('/').filter(Boolean).length > 1
}

/**
 * What is wrong with a destination, as a sentence to show — or `null` when it
 * looks streamable.
 *
 * Deliberately shallow: it catches what the form can see and leaves the rest to
 * the shell, which is the only thing that can decide whether a host resolves or
 * a key is accepted.
 */
export function destinationProblem(address: string, key: string): string | null {
  const trimmed = address.trim()
  if (trimmed === '') {
    return 'Paste the ingest address the platform gave you.'
  }
  const lower = trimmed.toLowerCase()
  if (lower.startsWith('rtmps://') || lower.startsWith('rtmp+tls://')) {
    return 'This build cannot speak rtmps yet — use the rtmp:// address instead. YouTube and Twitch both offer one.'
  }
  if (!lower.startsWith('rtmp://')) {
    return 'The ingest address must start with rtmp://.'
  }

  const rest = trimmed.slice('rtmp://'.length)
  const path = rest.includes('/') ? rest.slice(rest.indexOf('/') + 1) : ''
  if (path.split('/').filter(Boolean).length === 0) {
    return 'That address needs an application name — the live2 in rtmp://a.rtmp.youtube.com/live2.'
  }
  if (key.trim() === '' && !hasStreamName(trimmed)) {
    return 'Paste the stream key — the platform shows it beside its ingest address.'
  }
  return null
}

/**
 * The key with only its last four characters showing, so a destination can be
 * told apart from another one without the secret being readable over a shoulder
 * or in a screenshot. Short keys are shown as nothing but dots, because four
 * characters of a six-character key is most of it.
 */
export function maskKey(key: string): string {
  const trimmed = key.trim()
  if (trimmed === '') return ''
  if (trimmed.length <= 8) return '••••••••'
  return `••••••••${trimmed.slice(-4)}`
}

/**
 * How the stream-out is going. `error` is not a separate thing to the shell: it
 * is what a live stream becomes when the publisher reports a failure.
 */
export type StreamState = 'idle' | 'connecting' | 'live' | 'error'

export function stateFromFailure(failure: string | null): StreamState {
  return failure === null ? 'live' : 'error'
}

export const STREAM_LABELS: Record<StreamState, string> = {
  idle: 'Not streaming out',
  connecting: 'Connecting…',
  live: 'Streaming out',
  error: 'Stream stopped',
}

/** The tone the broadcast tile's badge should take, if any. */
export function streamTone(state: StreamState): 'live' | 'warn' | null {
  if (state === 'live') return 'live'
  if (state === 'error') return 'warn'
  return null
}
