import { describe, expect, it } from 'vitest'
import { parseIceServers, peerOptions } from './peerConfig'

function env(values: Record<string, string>): ImportMetaEnv {
  return values as unknown as ImportMetaEnv
}

describe('parseIceServers', () => {
  it('returns nothing when unset or malformed', () => {
    expect(parseIceServers(undefined)).toEqual([])
    expect(parseIceServers('')).toEqual([])
    expect(parseIceServers('not json')).toEqual([])
    expect(parseIceServers('{"urls":"stun:x"}')).toEqual([])
  })

  it('keeps entries that carry urls and drops the rest', () => {
    const servers = parseIceServers(
      '[{"urls":"stun:stun.example.com:3478"},{"username":"u"},{"urls":"turn:t:3478","credential":"p"}]',
    )
    expect(servers).toHaveLength(2)
    expect(servers[0]).toEqual({ urls: 'stun:stun.example.com:3478' })
    expect(servers[1]).toMatchObject({ urls: 'turn:t:3478', credential: 'p' })
  })
})

describe('peerOptions', () => {
  it('uses PeerJS defaults when nothing is configured', () => {
    expect(peerOptions(env({}))).toEqual({})
  })

  it('configures a self-hosted broker when the host is set', () => {
    const options = peerOptions(
      env({
        VITE_PEER_HOST: 'signal.example.com',
        VITE_PEER_PORT: '443',
        VITE_PEER_PATH: '/peer',
        VITE_PEER_KEY: 'peerjs',
        VITE_PEER_SECURE: 'true',
      }),
    )
    expect(options.host).toBe('signal.example.com')
    expect(options.port).toBe(443)
    expect(options.path).toBe('/peer')
    expect(options.key).toBe('peerjs')
    expect(options.secure).toBe(true)
    expect(options.config).toBeUndefined()
  })

  it('defaults the port to 443 and the path to / on a custom host', () => {
    const options = peerOptions(env({ VITE_PEER_HOST: 'signal.example.com' }))
    expect(options.port).toBe(443)
    expect(options.path).toBe('/')
    expect(options.secure).toBe(false)
  })

  it('passes ICE servers through when configured', () => {
    const options = peerOptions(
      env({ VITE_ICE_SERVERS: '[{"urls":"stun:stun.example.com:3478"}]' }),
    )
    expect(options.config).toEqual({ iceServers: [{ urls: 'stun:stun.example.com:3478' }] })
  })
})
