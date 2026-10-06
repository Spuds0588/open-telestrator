import { describe, expect, it } from 'vitest'
import {
  PLATFORMS,
  PLATFORM_GROUP,
  STREAM_LABELS,
  destinationProblem,
  hasStreamName,
  maskKey,
  platformFor,
  platformGroups,
  stateFromFailure,
  streamTone,
} from './streamOut'

describe('platforms', () => {
  it('offers only addresses the publisher can actually dial', () => {
    // Both schemes are dialled now — the Rust publisher wraps an `rtmps://`
    // socket in TLS — so a preset may use either, and neither an `http://` page
    // nor a bare hostname may slip in.
    for (const platform of PLATFORMS) {
      const reachable =
        platform.address === '' ||
        platform.address.startsWith('rtmp://') ||
        platform.address.startsWith('rtmps://')
      expect(reachable, platform.id).toBe(true)
    }
  })

  it('reaches the encrypted ingest of the platforms that only publish one', () => {
    // The reason the TLS half exists: these two have no plain address at all.
    const encrypted = PLATFORMS.filter((platform) => platform.address.startsWith('rtmps://'))
    expect(encrypted.map((platform) => platform.id)).toEqual(['facebook', 'instagram'])
  })

  it('passes its own validation, so no preset is a dead end', () => {
    // An address with no application name, or the wrong scheme, would be a
    // preset the form rejects the moment it is chosen.
    for (const platform of PLATFORMS) {
      if (platform.address === '') continue
      expect(destinationProblem(platform.address, 'abcd-efgh-ijkl'), platform.id).toBeNull()
    }
  })

  it('never bakes a stream key into a preset', () => {
    // A preset carries the address only; the key is always the user's own.
    for (const platform of PLATFORMS) {
      expect(hasStreamName(platform.address), platform.id).toBe(false)
    }
  })

  it('never points two platforms at the same address', () => {
    const addresses = PLATFORMS.map((platform) => platform.address).filter((address) => address !== '')
    expect(new Set(addresses).size).toBe(addresses.length)
  })

  it('names every platform and labels its key field', () => {
    for (const platform of PLATFORMS) {
      expect(platform.label.trim(), platform.id).not.toBe('')
      expect(platform.keyName.trim(), platform.id).not.toBe('')
    }
  })

  it('recognises a preset address, ignoring case and space', () => {
    expect(platformFor('  RTMP://a.rtmp.youtube.com/live2 ')?.id).toBe('youtube')
    expect(platformFor('rtmp://live.twitch.tv/app')?.id).toBe('twitch')
    expect(platformFor('rtmp://live.rumble.com/live/')?.id).toBe('rumble')
    expect(platformFor('rtmps://rtmp-api.facebook.com:443/rtmp/')?.id).toBe('facebook')
    expect(platformFor('rtmp://my.own.server/live')).toBeNull()
    expect(platformFor('')).toBeNull()
  })

  it('gives every platform a distinct id', () => {
    const ids = PLATFORMS.map((platform) => platform.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
})

describe('platformGroups', () => {
  it('files every platform exactly once, in roster order', () => {
    const grouped = platformGroups().flatMap((entry) => entry.platforms)
    expect(grouped).toEqual([...PLATFORMS])
  })

  it('keeps the declared group order rather than sorting the headings', () => {
    expect(platformGroups().map((entry) => entry.group)).toEqual([
      PLATFORM_GROUP.live,
      PLATFORM_GROUP.regional,
      PLATFORM_GROUP.events,
      PLATFORM_GROUP.pro,
      PLATFORM_GROUP.else,
    ])
  })

  it('leaves no heading empty', () => {
    for (const entry of platformGroups()) expect(entry.platforms.length).toBeGreaterThan(0)
  })

  it('ends with the escape hatch, which is the one preset with nothing to fill in', () => {
    const groups = platformGroups()
    const last = groups[groups.length - 1]
    expect(last.group).toBe(PLATFORM_GROUP.else)
    expect(last.platforms.map((platform) => platform.id)).toEqual(['custom'])
  })
})

describe('hasStreamName', () => {
  it('is true only when a name follows the application', () => {
    expect(hasStreamName('rtmp://a.rtmp.youtube.com/live2')).toBe(false)
    expect(hasStreamName('rtmp://a.rtmp.youtube.com/live2/abcd-efgh')).toBe(true)
    expect(hasStreamName('rtmp://host/live/')).toBe(false)
    expect(hasStreamName('rtmp://host')).toBe(false)
  })
})

describe('destinationProblem', () => {
  const good = 'rtmp://a.rtmp.youtube.com/live2'

  it('passes a complete destination', () => {
    expect(destinationProblem(good, 'abcd-efgh-ijkl')).toBeNull()
  })

  it('passes an address that already carries the key', () => {
    expect(destinationProblem(`${good}/abcd-efgh`, '')).toBeNull()
  })

  it('asks for the address first', () => {
    expect(destinationProblem('', 'key')).toMatch(/ingest address/i)
  })

  it('accepts an encrypted address, which is all some platforms offer', () => {
    expect(destinationProblem('rtmps://a.rtmp.youtube.com/live2', 'key')).toBeNull()
    expect(destinationProblem('rtmps://rtmp-api.facebook.com:443/rtmp/', 'key')).toBeNull()
    // The spelling a couple of platforms' copy buttons still produce.
    expect(destinationProblem('rtmp+tls://a.rtmp.youtube.com/live2', 'key')).toBeNull()
  })

  it('still asks for the key of an encrypted address', () => {
    expect(destinationProblem('rtmps://a.rtmp.youtube.com/live2', '')).toMatch(/stream key/i)
    expect(destinationProblem('rtmps://a.rtmp.youtube.com', 'key')).toMatch(/application name/i)
  })

  it('passes the address LinkedIn hands out, which is per event rather than a preset', () => {
    // Live Studio's shape: a per-account Azure channel on 2935, with the key in
    // the path and in its own field, which is what the platform expects to see.
    const key = 'aabbccddeeff00112233445566778899'
    const address = `rtmps://0b589bd53a314260bc5bc47e2ca5df37.channel.media.azure.net:2935/live/${key}`
    expect(destinationProblem(address, key)).toBeNull()
    expect(destinationProblem(address, '')).toBeNull()
    expect(hasStreamName(address)).toBe(true)
  })

  it('rejects another scheme or none at all', () => {
    expect(destinationProblem('https://example.com/live', 'key')).toMatch(/rtmp:\/\//)
    expect(destinationProblem('a.rtmp.youtube.com/live2', 'key')).toMatch(/rtmp:\/\//)
  })

  it('asks for the application name when the address is only a host', () => {
    expect(destinationProblem('rtmp://a.rtmp.youtube.com', 'key')).toMatch(/application name/i)
    expect(destinationProblem('rtmp://a.rtmp.youtube.com/', 'key')).toMatch(/application name/i)
  })

  it('asks for the key only when it is missing from both places', () => {
    expect(destinationProblem(good, '')).toMatch(/stream key/i)
    expect(destinationProblem(good, '   ')).toMatch(/stream key/i)
  })

  it('does not object to a key that contains a slash', () => {
    expect(destinationProblem('rtmp://ingest.example.com/app', 'a/b/c')).toBeNull()
  })
})

describe('maskKey', () => {
  it('hides all of a short key', () => {
    expect(maskKey('abc12345')).toBe('••••••••')
    expect(maskKey('abc')).toBe('••••••••')
  })

  it('shows only the tail of a long one', () => {
    const masked = maskKey('xxxx-yyyy-zzzz-1234')
    expect(masked).toBe('••••••••1234')
    expect(masked).not.toContain('xxxx')
  })

  it('is empty for no key', () => {
    expect(maskKey('')).toBe('')
    expect(maskKey('   ')).toBe('')
  })
})

describe('stream state', () => {
  it('reports a live stream until the shell reports a failure', () => {
    expect(stateFromFailure(null)).toBe('live')
    expect(stateFromFailure('The platform closed the connection.')).toBe('error')
  })

  it('labels every state', () => {
    for (const state of ['idle', 'connecting', 'live', 'error'] as const) {
      expect(STREAM_LABELS[state]).toBeTruthy()
    }
  })

  it('badges only the two states worth a badge', () => {
    expect(streamTone('live')).toBe('live')
    expect(streamTone('error')).toBe('warn')
    expect(streamTone('idle')).toBeNull()
    expect(streamTone('connecting')).toBeNull()
  })
})
