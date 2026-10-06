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
 * A preset earns its place by three rules, and the tests in the sibling file
 * hold them:
 *
 * 1. **It is a scheme the publisher can actually dial.** Both `rtmp://` and the
 *    encrypted `rtmps://` work — the Rust half speaks TLS, which is what made
 *    Facebook Live and Instagram reachable — so a preset may use either. What a
 *    preset may not do is point somewhere the publisher cannot go at all, like
 *    an `http://` page that is an address a platform put in a help centre.
 * 2. **The address is the same for everybody, and is a host plus one path
 *    segment.** A service that issues each account its own ingest *host* cannot
 *    be a preset, because a guess would send someone's key to the wrong server.
 *    Amazon IVS (a per-channel subdomain), TikTok (a per-region host) and
 *    LinkedIn Live (a per-event channel on a per-account Azure host,
 *    `…channel.media.azure.net:2935/live/…`) all fall to **Something else**,
 *    where the user pastes what their dashboard gave them. A fixed path of two
 *    segments is no better, because both this form and `media/src/url.rs` read
 *    the first segment as the application and the rest as the stream name — so
 *    niconico's `/live/input` would arrive as an application plus a stream name
 *    rather than an application alone.
 * 3. **No adult services.** A telestrator is used next to a pitch or a court.
 *
 * The addresses themselves are the ones the services publish; the maintained
 * list OBS ships is the reference for most of them. None carries a slash or a
 * placeholder past its application name, so none can have a stream key baked in.
 */

export interface Destination {
  address: string
  key: string
}

/**
 * The picker's groups, in the order they appear. Each preset names one, so a
 * typo is a type error rather than a silently short second group.
 */
export const PLATFORM_GROUP = {
  live: 'Live platforms',
  regional: 'Regional platforms',
  events: 'Sport, worship & events',
  pro: 'Restream & pro video',
  else: 'Something else',
} as const

export type PlatformGroupName = (typeof PLATFORM_GROUP)[keyof typeof PLATFORM_GROUP]

export interface Platform {
  id: string
  label: string
  /** Which heading the picker files it under. */
  group: PlatformGroupName
  /** Empty for "something else", which the user fills in. */
  address: string
  /** What the platform calls the key, for the field's placeholder. */
  keyName: string
}

export const PLATFORMS: readonly Platform[] = [
  {
    id: 'youtube',
    label: 'YouTube Live',
    group: PLATFORM_GROUP.live,
    address: 'rtmp://a.rtmp.youtube.com/live2',
    keyName: 'Stream key',
  },
  {
    id: 'twitch',
    label: 'Twitch',
    group: PLATFORM_GROUP.live,
    address: 'rtmp://live.twitch.tv/app',
    keyName: 'Stream key',
  },
  {
    // Encrypted only, which is why this preset needed the TLS half to exist.
    id: 'facebook',
    label: 'Facebook Live',
    group: PLATFORM_GROUP.live,
    address: 'rtmps://rtmp-api.facebook.com:443/rtmp/',
    keyName: 'Stream key',
  },
  {
    // Also encrypted only, and also from the Live Producer page.
    id: 'instagram',
    label: 'Instagram Live',
    group: PLATFORM_GROUP.live,
    address: 'rtmps://live-upload.instagram.com:443/rtmp/',
    keyName: 'Stream key',
  },
  {
    id: 'rumble',
    label: 'Rumble',
    group: PLATFORM_GROUP.live,
    address: 'rtmp://live.rumble.com/live/',
    keyName: 'Stream key',
  },
  {
    id: 'trovo',
    label: 'Trovo',
    group: PLATFORM_GROUP.live,
    address: 'rtmp://livepush.trovo.live/live/',
    keyName: 'Stream key',
  },
  {
    id: 'steam',
    label: 'Steam',
    group: PLATFORM_GROUP.live,
    address: 'rtmp://ingest-rtmp.broadcast.steamcontent.com/app',
    keyName: 'Stream key',
  },
  {
    id: 'picarto',
    label: 'Picarto',
    group: PLATFORM_GROUP.live,
    address: 'rtmp://live.us.picarto.tv/golive',
    keyName: 'Stream key',
  },
  {
    id: 'mixcloud',
    label: 'Mixcloud',
    group: PLATFORM_GROUP.live,
    address: 'rtmp://rtmp.mixcloud.com/broadcast',
    keyName: 'Stream key',
  },
  {
    id: 'soop',
    label: 'SOOP (AfreecaTV)',
    group: PLATFORM_GROUP.live,
    address: 'rtmp://stream.soop.live/app/',
    keyName: 'Stream key',
  },
  {
    id: 'chzzk',
    label: 'CHZZK',
    group: PLATFORM_GROUP.live,
    address: 'rtmp://global-rtmp.lip2.navercorp.com:8080/relay',
    keyName: 'Stream key',
  },
  {
    id: 'nimo',
    label: 'Nimo TV',
    group: PLATFORM_GROUP.live,
    address: 'rtmp://txpush.rtmp.nimo.tv/live/',
    keyName: 'Stream key',
  },
  {
    id: 'bilibili',
    label: 'Bilibili Live',
    group: PLATFORM_GROUP.regional,
    address: 'rtmp://live-push.bilivideo.com/live-bvc/',
    keyName: 'Stream key',
  },
  {
    id: 'kuaishou',
    label: 'Kuaishou Live',
    group: PLATFORM_GROUP.regional,
    address: 'rtmp://open-push.voip.yximgs.com/gifshow/',
    keyName: 'Stream key',
  },
  {
    id: 'kakao',
    label: 'KakaoTV',
    group: PLATFORM_GROUP.regional,
    address: 'rtmp://rtmp.play.kakao.com/kakaotv',
    keyName: 'Stream key',
  },
  {
    id: 'goodgame',
    label: 'GoodGame.ru',
    group: PLATFORM_GROUP.regional,
    address: 'rtmp://msk.goodgame.ru:1940/live',
    keyName: 'Stream key',
  },
  {
    id: 'aparat',
    label: 'Aparat',
    group: PLATFORM_GROUP.regional,
    address: 'rtmp://rtmp.cdn.asset.aparat.com:443/event',
    keyName: 'Stream key',
  },
  {
    id: 'meridix',
    label: 'Meridix',
    group: PLATFORM_GROUP.events,
    address: 'rtmp://publish.meridix.com/live',
    keyName: 'Stream key',
  },
  {
    id: 'sermonaudio',
    label: 'SermonAudio',
    group: PLATFORM_GROUP.events,
    address: 'rtmp://webcast.sermonaudio.com/sa',
    keyName: 'Stream key',
  },
  {
    id: 'boxcast',
    label: 'BoxCast',
    group: PLATFORM_GROUP.events,
    address: 'rtmp://rtmp.boxcast.com/live',
    keyName: 'Stream key',
  },
  {
    id: 'wpstream',
    label: 'WpStream',
    group: PLATFORM_GROUP.events,
    address: 'rtmp://ingest.wpstream.net/golive',
    keyName: 'Stream key',
  },
  {
    id: 'eventlive',
    label: 'EventLive.pro',
    group: PLATFORM_GROUP.events,
    address: 'rtmp://go.eventlive.pro/live',
    keyName: 'Stream key',
  },
  {
    id: 'sympla',
    label: 'Sympla',
    group: PLATFORM_GROUP.events,
    address: 'rtmp://rtmp.sympla.com.br:5222/app',
    keyName: 'Stream key',
  },
  {
    id: 'restream',
    label: 'Restream.io',
    group: PLATFORM_GROUP.pro,
    address: 'rtmp://live.restream.io/live',
    keyName: 'Stream key',
  },
  {
    id: 'castr',
    label: 'Castr.io',
    group: PLATFORM_GROUP.pro,
    address: 'rtmp://cg.castr.io/static',
    keyName: 'Stream key',
  },
  {
    id: 'livepush',
    label: 'Livepush',
    group: PLATFORM_GROUP.pro,
    address: 'rtmp://dc-global.livepush.io/live',
    keyName: 'Stream key',
  },
  {
    id: 'livepeer',
    label: 'Livepeer Studio',
    group: PLATFORM_GROUP.pro,
    address: 'rtmp://rtmp.livepeer.com/live',
    keyName: 'Stream key',
  },
  {
    id: 'mux',
    label: 'Mux',
    group: PLATFORM_GROUP.pro,
    address: 'rtmp://global-live.mux.com:5222/app',
    keyName: 'Stream key',
  },
  {
    id: 'apivideo',
    label: 'api.video',
    group: PLATFORM_GROUP.pro,
    address: 'rtmp://broadcast.api.video/s',
    keyName: 'Stream key',
  },
  {
    id: 'bitmovin',
    label: 'Bitmovin',
    group: PLATFORM_GROUP.pro,
    address: 'rtmp://live-input.bitmovin.com/streams',
    keyName: 'Stream key',
  },
  {
    id: 'custom',
    label: 'Something else',
    group: PLATFORM_GROUP.else,
    address: '',
    keyName: 'Stream key',
  },
]

export interface PlatformGroup {
  group: PlatformGroupName
  platforms: Platform[]
}

/**
 * The presets filed under their headings, in the order the headings first
 * appear, so the picker can render `<optgroup>`s without knowing the roster.
 */
export function platformGroups(): PlatformGroup[] {
  const groups: PlatformGroup[] = []
  for (const platform of PLATFORMS) {
    const found = groups.find((entry) => entry.group === platform.group)
    if (found) found.platforms.push(platform)
    else groups.push({ group: platform.group, platforms: [platform] })
  }
  return groups
}

/** The platform whose address matches, or null when it is one we do not know. */
export function platformFor(address: string): Platform | null {
  const trimmed = address.trim().toLowerCase()
  if (trimmed === '') return null
  return PLATFORMS.find((platform) => platform.address !== '' && platform.address === trimmed) ?? null
}

/**
 * The path segments an ingest address carries, scheme and authority removed.
 * Both this and the Rust parser read the first as the application and the rest
 * as the stream name, so a form that counted them differently would disagree
 * with the thing that actually connects.
 */
function pathSegments(address: string): string[] {
  const rest = address.trim().replace(/^(rtmps?|rtmp\+tls):\/\//i, '')
  const path = rest.includes('/') ? rest.slice(rest.indexOf('/') + 1) : ''
  return path.split('/').filter(Boolean)
}

/** Whether the address already carries a stream name after the application. */
export function hasStreamName(address: string): boolean {
  return pathSegments(address).length > 1
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
  // `rtmps://` and the `rtmp+tls://` some platforms still print are the same
  // thing to the publisher, which encrypts the socket for both.
  const lower = trimmed.toLowerCase()
  const dialled =
    lower.startsWith('rtmp://') || lower.startsWith('rtmps://') || lower.startsWith('rtmp+tls://')
  if (!dialled) {
    return 'The ingest address must start with rtmp:// or rtmps:// — the second one is the encrypted ingest.'
  }

  if (pathSegments(trimmed).length === 0) {
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
