import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  EMBED_PARAM,
  RESERVATION_MS,
  STALE_VIEWER_MS,
  buildViewerLink,
  chooseParent,
  isReservationStale,
  isTransportDead,
  isViewerGone,
  mixBroadcastStream,
  parseBroadcastMessage,
  parseViewerLink,
  wantsEmbed,
} from './broadcast'

class FakeMediaStream {
  constructor(readonly tracks: MediaStreamTrack[]) {}

  getTracks(): MediaStreamTrack[] {
    return this.tracks
  }
}

function track(kind: string): MediaStreamTrack {
  return { kind } as MediaStreamTrack
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('viewer links', () => {
  it('round-trips a session through a plain origin', () => {
    const link = buildViewerLink('http://localhost:5173/', { hostId: 'host-9', token: 'abc123' })
    expect(parseViewerLink(link)).toEqual({ hostId: 'host-9', token: 'abc123' })
    expect(new URL(link).searchParams.get('watch')).toBe('host-9')
  })

  it('stays inside the app sub-path and replaces a stale session', () => {
    const link = buildViewerLink(
      'https://spuds0588.github.io/open-telestrator/?watch=stale&t=stale',
      { hostId: 'p', token: 'q' },
    )
    expect(link.startsWith('https://spuds0588.github.io/open-telestrator/?')).toBe(true)
    expect(parseViewerLink(link)).toEqual({ hostId: 'p', token: 'q' })
  })

  it('rejects incomplete or foreign URLs', () => {
    expect(parseViewerLink('https://example.com/')).toBeNull()
    expect(parseViewerLink('https://example.com/?watch=only')).toBeNull()
    expect(parseViewerLink('not a url')).toBeNull()
  })
})

describe('wantsEmbed', () => {
  const link = 'https://spuds0588.github.io/open-telestrator/?watch=h&t=k'

  it('lets the link answer outright either way', () => {
    const ask = (value: string, framed = false, referrer = 'https://portal.test/') =>
      wantsEmbed({ href: `${link}&${EMBED_PARAM}=${value}`, framed, referrer })
    expect(ask('1')).toBe(true)
    expect(ask('')).toBe(true)
    expect(ask('true')).toBe(true)
    // An explicit no wins even where the surroundings look like an embed.
    expect(ask('0', true)).toBe(false)
    expect(ask('false', true, 'https://portal.test/')).toBe(false)
  })

  it('embeds a framed page even with nothing in the link', () => {
    expect(wantsEmbed({ href: link, framed: true, referrer: '' })).toBe(true)
    expect(wantsEmbed({ href: link, framed: true, referrer: link })).toBe(true)
  })

  it('embeds a page linked from another origin', () => {
    expect(wantsEmbed({ href: link, framed: false, referrer: 'https://portal.test/live' })).toBe(true)
  })

  it('keeps the full viewer on our own pages and for direct visits', () => {
    expect(wantsEmbed({ href: link, framed: false, referrer: '' })).toBe(false)
    expect(wantsEmbed({ href: link, framed: false, referrer: link })).toBe(false)
    expect(wantsEmbed({ href: link, framed: false, referrer: 'not a url' })).toBe(false)
    // An unreadable link cannot even prove it is ours; stay put.
    expect(wantsEmbed({ href: 'not a url', framed: false, referrer: 'https://portal.test/' })).toBe(
      false,
    )
  })

  it('survives an embed flag riding along with the session', () => {
    const embedded = `${buildViewerLink('https://x.test/', { hostId: 'h', token: 'k' })}&${EMBED_PARAM}=1`
    expect(parseViewerLink(embedded)).toEqual({ hostId: 'h', token: 'k' })
    expect(wantsEmbed({ href: embedded, framed: false, referrer: '' })).toBe(true)
  })
})

describe('parseBroadcastMessage', () => {
  it('accepts the known messages', () => {
    expect(parseBroadcastMessage({ t: 'join', token: 'x' })).toEqual({ t: 'join', token: 'x' })
    expect(parseBroadcastMessage({ t: 'feed', token: 'x' })).toEqual({ t: 'feed', token: 'x' })
    expect(parseBroadcastMessage({ t: 'parent', parentId: 'abc' })).toEqual({
      t: 'parent',
      parentId: 'abc',
    })
    expect(parseBroadcastMessage({ t: 'relay', children: 2 })).toEqual({ t: 'relay', children: 2 })
    expect(parseBroadcastMessage({ t: 'full' })).toEqual({ t: 'full' })
  })

  it('rejects junk, missing fields and impossible values', () => {
    expect(parseBroadcastMessage(null)).toBeNull()
    expect(parseBroadcastMessage('join')).toBeNull()
    expect(parseBroadcastMessage({ t: 'join' })).toBeNull()
    expect(parseBroadcastMessage({ t: 'join', token: '' })).toBeNull()
    expect(parseBroadcastMessage({ t: 'parent' })).toBeNull()
    expect(parseBroadcastMessage({ t: 'relay', children: -1 })).toBeNull()
    expect(parseBroadcastMessage({ t: 'relay', children: 'many' })).toBeNull()
    expect(parseBroadcastMessage({ t: 'unknown' })).toBeNull()
  })
})

describe('chooseParent', () => {
  it('prefers the host when it has space', () => {
    expect(
      chooseParent([
        { id: 'host', free: 2 },
        { id: 'relay-a', free: 2 },
      ]),
    ).toBe('host')
  })

  it('picks the node with the most free slots', () => {
    expect(
      chooseParent([
        { id: 'host', free: 0 },
        { id: 'relay-a', free: 1 },
        { id: 'relay-b', free: 2 },
      ]),
    ).toBe('relay-b')
  })

  it('returns null when every node is full', () => {
    expect(
      chooseParent([
        { id: 'host', free: 0 },
        { id: 'relay-a', free: 0 },
      ]),
    ).toBeNull()
    expect(chooseParent([])).toBeNull()
  })
})

describe('viewer liveness', () => {
  it('treats a failed, closed or disconnected transport as dead', () => {
    expect(isTransportDead('failed')).toBe(true)
    expect(isTransportDead('closed')).toBe(true)
    expect(isTransportDead('disconnected')).toBe(true)
    expect(isTransportDead('connected')).toBe(false)
    expect(isTransportDead('connecting')).toBe(false)
    expect(isTransportDead(undefined)).toBe(false)
  })

  it('drops a viewer whose transport died, whatever its heartbeat', () => {
    const now = 1_000_000
    expect(isViewerGone('failed', now, now)).toBe(true)
    expect(isViewerGone('closed', now, now)).toBe(true)
  })

  it('keeps a viewer that has only just fallen silent', () => {
    const now = 1_000_000
    expect(isViewerGone('connected', now - 1_000, now)).toBe(false)
    expect(isViewerGone('connected', now - STALE_VIEWER_MS, now)).toBe(false)
  })

  it('drops a viewer that has said nothing for far too long', () => {
    const now = 1_000_000
    expect(isViewerGone('connected', now - STALE_VIEWER_MS - 1, now)).toBe(true)
  })

  it('keeps a viewer it has not heard from yet', () => {
    expect(isViewerGone('connecting', undefined, 1_000_000)).toBe(false)
  })

  it('expires a handoff reservation only once it is old enough', () => {
    const now = 1_000_000
    expect(isReservationStale(now - RESERVATION_MS, now)).toBe(false)
    expect(isReservationStale(now - RESERVATION_MS - 1, now)).toBe(true)
  })
})

describe('mixBroadcastStream', () => {
  it('sends the program video plus the mixed audio', () => {
    vi.stubGlobal('MediaStream', FakeMediaStream)
    const video = track('video')
    const sound = track('audio')
    const program = { getVideoTracks: () => [video] } as unknown as MediaStream
    const audio = { getAudioTracks: () => [sound] } as unknown as MediaStream

    const mixed = mixBroadcastStream(program, audio)

    expect(mixed).not.toBeNull()
    expect(mixed!.getTracks()).toEqual([video, sound])
  })

  it('broadcasts audio-only when there is no program video', () => {
    vi.stubGlobal('MediaStream', FakeMediaStream)
    const sound = track('audio')
    const mixed = mixBroadcastStream(null, {
      getAudioTracks: () => [sound],
    } as unknown as MediaStream)
    expect(mixed!.getTracks()).toEqual([sound])
  })

  it('returns null when there is nothing to send', () => {
    vi.stubGlobal('MediaStream', FakeMediaStream)
    expect(mixBroadcastStream(null, null)).toBeNull()
    expect(
      mixBroadcastStream(
        { getVideoTracks: () => [] } as unknown as MediaStream,
        { getAudioTracks: () => [] } as unknown as MediaStream,
      ),
    ).toBeNull()
  })
})
