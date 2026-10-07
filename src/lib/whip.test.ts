import { describe, expect, it } from 'vitest'
import {
  DEFAULT_DESTINATION,
  STREAM_LABELS,
  WHIP_SERVICES,
  connectionProblem,
  destinationProblem,
  maskSecret,
  publishHeaders,
  publishProblem,
  resolveResource,
  serviceFor,
  silentWarning,
  streamTone,
  whipDelete,
  whipPost,
  type WhipDestination,
} from './whip'

const RESTREAM = 'https://live.restream.io/whip/endpoint/abc123def456/xyz'

function destination(over: Partial<WhipDestination> = {}): WhipDestination {
  return { ...DEFAULT_DESTINATION, url: RESTREAM, ...over }
}

/** A fetch that answers with one response, recording what it was called with. */
function stub(response: Response | (() => Promise<Response>)): {
  calls: Array<{ url: string; init: RequestInit | undefined }>
  fetcher: typeof fetch
} {
  const calls: Array<{ url: string; init: RequestInit | undefined }> = []
  const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init })
    if (typeof response === 'function') return response()
    return response
  }) as typeof fetch
  return { calls, fetcher }
}

describe('the services on offer', () => {
  it('is three routes, with the one that reaches a platform first', () => {
    expect(WHIP_SERVICES.map((service) => service.id)).toEqual(['restream', 'cloudflare', 'livekit'])
  })

  it('gives every service the four things the form needs', () => {
    for (const service of WHIP_SERVICES) {
      expect(service.label.length, service.id).toBeGreaterThan(0)
      expect(service.field.length, service.id).toBeGreaterThan(0)
      expect(service.where.length, service.id).toBeGreaterThan(0)
      expect(service.outcome.length, service.id).toBeGreaterThan(0)
      // A link to the service's own instructions, because the paste is never
      // where anybody expects it to be.
      expect(service.docs.startsWith('https://'), service.id).toBe(true)
    }
  })

  it('says of each one what happens to the picture afterwards', () => {
    // The difference between these three is the whole reason to offer three, so
    // each outcome has to be a different fact rather than the same promise.
    const outcomes = WHIP_SERVICES.map((service) => service.outcome)
    expect(new Set(outcomes).size).toBe(WHIP_SERVICES.length)
    expect(outcomes[0]).toContain('RTMP')
    expect(outcomes[1]).toContain('Nothing is forwarded')
    expect(outcomes[2]).toContain('egress')
  })

  it('finds a service by id and nothing by a stranger', () => {
    expect(serviceFor('cloudflare')?.label).toBe('Cloudflare Stream')
    expect(serviceFor('youtube')).toBeNull()
    expect(serviceFor('')).toBeNull()
  })

  it('picks Restream to begin with, because it is the one everybody wants', () => {
    expect(DEFAULT_DESTINATION.service).toBe('restream')
    expect(DEFAULT_DESTINATION.url).toBe('')
    expect(DEFAULT_DESTINATION.token).toBe('')
  })
})

describe('destinationProblem', () => {
  it('asks for the URL when there is nothing to go on', () => {
    expect(destinationProblem(destination({ url: '' }))).toContain('Paste the publish URL')
    expect(destinationProblem(destination({ url: '   ' }))).toContain('Paste the publish URL')
  })

  it('refuses something that is not a URL at all', () => {
    expect(destinationProblem(destination({ url: 'live.restream.io' }))).toContain('not a URL')
    expect(destinationProblem(destination({ url: 'nonsense' }))).toContain('not a URL')
  })

  it('refuses a plain http address, which the browser would block anyway', () => {
    const problem = destinationProblem(destination({ url: 'http://live.restream.io/whip/abc' }))
    expect(problem).toContain('https://')
  })

  it('refuses a bare host, which is a home page rather than a broadcast', () => {
    expect(destinationProblem(destination({ url: 'https://stream.cloudflare.com' }))).toContain(
      'home page'
    )
    expect(destinationProblem(destination({ url: 'https://stream.cloudflare.com/' }))).toContain(
      'home page'
    )
  })

  it('accepts each service’s real endpoint — anything with a path', () => {
    for (const url of [
      RESTREAM,
      'https://customer-example.cloudflarestream.com/abc123/webRTC/publish',
      'https://myproject.livekit.cloud/w/ingress123',
    ]) {
      expect(destinationProblem(destination({ url })), url).toBeNull()
    }
  })

  it('tolerates a trailing space, which a paste brings with it', () => {
    expect(destinationProblem(destination({ url: ` ${RESTREAM} ` }))).toBeNull()
  })
})

describe('maskSecret', () => {
  it('shows the tail of a long value and hides everything else', () => {
    expect(maskSecret('abcdefghijkl')).toBe('••••••••ijkl')
  })

  it('shows nothing of a short one, where four characters would be most of it', () => {
    expect(maskSecret('abc123')).toBe('••••••••')
    expect(maskSecret('abcdefgh')).toBe('••••••••')
  })

  it('shows nothing at all when there is nothing', () => {
    expect(maskSecret('')).toBe('')
    expect(maskSecret('   ')).toBe('')
  })
})

describe('publishHeaders', () => {
  it('sends an SDP content type', () => {
    expect(publishHeaders('')).toEqual({ 'Content-Type': 'application/sdp' })
  })

  it('adds a bearer token when there is one', () => {
    expect(publishHeaders('secret')).toEqual({
      'Content-Type': 'application/sdp',
      Authorization: 'Bearer secret',
    })
    expect(publishHeaders('  secret  ').Authorization).toBe('Bearer secret')
  })
})

describe('publishProblem', () => {
  it('reads a refusal as a cause rather than a number', () => {
    expect(publishProblem(401, '')).toContain('credential')
    expect(publishProblem(403, '')).toContain('credential')
    expect(publishProblem(404, '')).toContain('nothing at that address')
    expect(publishProblem(405, '')).toContain('does not accept a broadcast')
    expect(publishProblem(409, '')).toContain('already publishing')
    expect(publishProblem(415, '')).toContain('SDP')
    expect(publishProblem(429, '')).toContain('rate-limiting')
  })

  it('blames the service for a server error and asks for a retry', () => {
    expect(publishProblem(503, '')).toContain('on its side')
    expect(publishProblem(500, '')).toContain('Try again')
  })

  it('falls back to the number for anything it has no theory about', () => {
    expect(publishProblem(418, '')).toContain('418')
  })

  it('carries what the service said, cut to something readable', () => {
    expect(publishProblem(404, 'no such input')).toContain('no such input')
    // A service that answers with a page of HTML must not put a page of HTML in
    // the panel: the detail is capped, not the sentence around it.
    const long = publishProblem(404, 'x'.repeat(500))
    expect(long).toContain('x'.repeat(200))
    expect(long).not.toContain('x'.repeat(201))
  })

  it('says nothing extra when the service said nothing', () => {
    expect(publishProblem(404, '   ')).not.toContain('The service said')
  })
})

describe('resolveResource', () => {
  it('keeps an absolute location as it is', () => {
    expect(resolveResource('https://live.restream.io/whip/abc', RESTREAM)).toBe(
      'https://live.restream.io/whip/abc'
    )
  })

  it('resolves a relative one against the endpoint, as the spec allows', () => {
    expect(resolveResource('abc123', RESTREAM)).toBe('https://live.restream.io/whip/endpoint/abc123def456/abc123')
    expect(resolveResource('/whip/abc123', RESTREAM)).toBe('https://live.restream.io/whip/abc123')
  })

  it('is nothing when the service sent no location', () => {
    expect(resolveResource(null, RESTREAM)).toBeNull()
    expect(resolveResource('', RESTREAM)).toBeNull()
  })
})

describe('whipPost', () => {
  const answer = 'v=0\r\no=- 1 2 IN IP4 127.0.0.1\r\n'
  const accepts = () =>
    new Response(answer, {
      status: 201,
      headers: { 'Content-Type': 'application/sdp', Location: 'abc123' },
    })

  it('posts an offer as SDP and returns the answer and where to hang up', async () => {
    const { calls, fetcher } = stub(accepts())
    const result = await whipPost(RESTREAM, 'v=0\r\no=offer\r\n', '', fetcher)
    expect(result).toEqual({
      answer,
      resource: 'https://live.restream.io/whip/endpoint/abc123def456/abc123',
    })
    expect(calls[0].url).toBe(RESTREAM)
    expect(calls[0].init?.method).toBe('POST')
    expect(calls[0].init?.body).toBe('v=0\r\no=offer\r\n')
  })

  it('sends the token when the endpoint wants one', async () => {
    const { calls, fetcher } = stub(accepts())
    await whipPost(RESTREAM, 'offer', 'tok', fetcher)
    expect((calls[0].init?.headers as Record<string, string>).Authorization).toBe('Bearer tok')
  })

  it('reports a refusal with the service’s own words', async () => {
    const { fetcher } = stub(new Response('input not found', { status: 404 }))
    const result = await whipPost(RESTREAM, 'offer', '', fetcher)
    expect('problem' in result && result.problem).toContain('input not found')
  })

  it('refuses to call an empty answer a success', async () => {
    // A service that accepts and says nothing has given nothing to apply, and
    // reporting "live" here would put a black picture on air silently.
    const { fetcher } = stub(new Response('', { status: 201 }))
    const result = await whipPost(RESTREAM, 'offer', '', fetcher)
    expect('problem' in result && result.problem).toContain('no answer')
  })

  it('turns a thrown request into the sentence about cross-origin', async () => {
    // What a CORS refusal looks like from here: a fetch that rejects with an
    // opaque TypeError. This is the failure that decides whether the browser can
    // publish to a service at all, so it is named rather than numbered.
    const { fetcher } = stub(() => Promise.reject(new TypeError('Failed to fetch')))
    const result = await whipPost(RESTREAM, 'offer', '', fetcher)
    expect('problem' in result && result.problem).toContain('cross-origin')
    expect('problem' in result && result.problem).toContain('Failed to fetch')
  })

  it('copes with a service that sends no location header', async () => {
    const { fetcher } = stub(new Response(answer, { status: 200 }))
    const result = await whipPost(RESTREAM, 'offer', '', fetcher)
    expect('resource' in result && result.resource).toBeNull()
  })
})

describe('whipDelete', () => {
  it('hangs up on the resource the service named', async () => {
    const { calls, fetcher } = stub(new Response(null, { status: 200 }))
    expect(await whipDelete('https://live.restream.io/whip/abc', '', fetcher)).toBe(true)
    expect(calls[0].init?.method).toBe('DELETE')
    // A DELETE carries no body, so it must not claim to be sending SDP.
    expect((calls[0].init?.headers as Record<string, string>)['Content-Type']).toBeUndefined()
  })

  it('is quietly nothing when there is no resource to hang up on', async () => {
    const { calls, fetcher } = stub(new Response(null, { status: 200 }))
    expect(await whipDelete(null, '', fetcher)).toBe(false)
    expect(calls).toHaveLength(0)
  })

  it('never throws, whatever the service does', async () => {
    const refused = stub(new Response('no', { status: 404 }))
    expect(await whipDelete(RESTREAM, '', refused.fetcher)).toBe(false)
    const thrown = stub(() => Promise.reject(new Error('offline')))
    expect(await whipDelete(RESTREAM, '', thrown.fetcher)).toBe(false)
  })
})

describe('the two warnings', () => {
  it('says a broadcast with no audio selected will be silent', () => {
    expect(silentWarning(false)).toContain('silent')
    expect(silentWarning(true)).toBeNull()
  })

  it('reads a dead peer connection as a sentence', () => {
    expect(connectionProblem('failed')).toContain('failed')
    expect(connectionProblem('closed')).toContain('ended')
    expect(connectionProblem('connected')).toBeNull()
    expect(connectionProblem('connecting')).toBeNull()
  })
})

describe('the labels the panel shows', () => {
  it('names each state and tones two of them', () => {
    expect(Object.keys(STREAM_LABELS)).toEqual(['idle', 'connecting', 'live', 'error'])
    expect(streamTone('live')).toBe('live')
    expect(streamTone('error')).toBe('warn')
    expect(streamTone('idle')).toBeNull()
    expect(streamTone('connecting')).toBeNull()
  })
})
