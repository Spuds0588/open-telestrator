import { describe, expect, it } from 'vitest'
import { buildCameraLink, createToken, parseCameraLink } from './cameraLink'

describe('createToken', () => {
  it('returns a 32-character hex token', () => {
    expect(createToken()).toMatch(/^[0-9a-f]{32}$/)
  })

  it('returns a fresh token on every call', () => {
    expect(createToken()).not.toBe(createToken())
  })
})

describe('buildCameraLink / parseCameraLink', () => {
  it('round-trips a session through a plain origin', () => {
    const link = buildCameraLink('http://localhost:5173/', { hostId: 'host-1', token: 'abc123' })
    const url = new URL(link)
    expect(url.searchParams.get('camera')).toBe('host-1')
    expect(url.searchParams.get('t')).toBe('abc123')
    expect(parseCameraLink(link)).toEqual({ hostId: 'host-1', token: 'abc123' })
  })

  it('stays inside the app sub-path on GitHub Pages and replaces a stale session', () => {
    const link = buildCameraLink(
      'https://spuds0588.github.io/open-telestrator/?camera=stale&t=stale',
      { hostId: 'p', token: 'q' },
    )
    expect(link.startsWith('https://spuds0588.github.io/open-telestrator/?')).toBe(true)
    expect(parseCameraLink(link)).toEqual({ hostId: 'p', token: 'q' })
  })

  it('rejects URLs that are not camera links or are incomplete', () => {
    expect(parseCameraLink('https://example.com/')).toBeNull()
    expect(parseCameraLink('https://example.com/?camera=only')).toBeNull()
    expect(parseCameraLink('https://example.com/?t=only')).toBeNull()
    expect(parseCameraLink('not a url')).toBeNull()
  })
})
