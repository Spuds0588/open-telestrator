import { describe, expect, it } from 'vitest'
import {
  buildCameraLink,
  createToken,
  parseCameraLink,
  parseCameraReport,
  viewersReport,
} from './cameraLink'

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

describe('viewer reports', () => {
  it('round-trips a count the host built', () => {
    expect(parseCameraReport(viewersReport(7))).toEqual({ t: 'viewers', count: 7 })
  })

  it('never reports a negative count', () => {
    expect(viewersReport(-3)).toEqual({ t: 'viewers', count: 0 })
    expect(parseCameraReport({ t: 'viewers', count: -1 })).toBeNull()
  })

  it('rejects junk, unknown messages and impossible counts', () => {
    expect(parseCameraReport(null)).toBeNull()
    expect(parseCameraReport('viewers')).toBeNull()
    expect(parseCameraReport({})).toBeNull()
    expect(parseCameraReport({ t: 'watchers', count: 2 })).toBeNull()
    expect(parseCameraReport({ t: 'viewers' })).toBeNull()
    expect(parseCameraReport({ t: 'viewers', count: 'two' })).toBeNull()
    expect(parseCameraReport({ t: 'viewers', count: Number.NaN })).toBeNull()
    expect(parseCameraReport({ t: 'viewers', count: Number.POSITIVE_INFINITY })).toBeNull()
  })

  it('floors a fractional count rather than showing a fraction of a viewer', () => {
    expect(parseCameraReport({ t: 'viewers', count: 2.7 })).toEqual({ t: 'viewers', count: 2 })
  })
})
