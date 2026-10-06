import { describe, expect, it } from 'vitest'
import {
  PLATFORMS,
  STREAM_LABELS,
  destinationProblem,
  hasStreamName,
  maskKey,
  platformFor,
  stateFromFailure,
  streamTone,
} from './streamOut'

describe('platforms', () => {
  it('offers only addresses the publisher can actually reach', () => {
    // rtmps is not implemented in the Rust publisher, so no preset may use it.
    for (const platform of PLATFORMS) {
      expect(platform.address === '' || platform.address.startsWith('rtmp://')).toBe(true)
    }
  })

  it('recognises a preset address, ignoring case and space', () => {
    expect(platformFor('  RTMP://a.rtmp.youtube.com/live2 ')?.id).toBe('youtube')
    expect(platformFor('rtmp://live.twitch.tv/app')?.id).toBe('twitch')
    expect(platformFor('rtmp://my.own.server/live')).toBeNull()
    expect(platformFor('')).toBeNull()
  })

  it('gives every platform a distinct id', () => {
    const ids = PLATFORMS.map((platform) => platform.id)
    expect(new Set(ids).size).toBe(ids.length)
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

  it('names rtmps as the one thing this build cannot do, and offers the way out', () => {
    const problem = destinationProblem('rtmps://a.rtmp.youtube.com/live2', 'key')
    expect(problem).toMatch(/rtmps/)
    // The message has to say what to do instead, not just that it failed.
    expect(problem).toMatch(/rtmp:\/\//)
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
