import { describe, expect, it } from 'vitest'
import {
  buildCameraLink,
  createToken,
  parseCameraLink,
  parseCameraReport,
  parseRole,
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
    expect(url.pathname).toBe('/app.html')
    expect(parseCameraLink(link)).toEqual({ hostId: 'host-1', token: 'abc123', role: 'cohost' })
  })

  it('leaves the co-host role unspoken, and spells out only a camera link', () => {
    // One session, two doors: the role is what differs, and a co-host link is
    // the one every earlier version minted — no parameter at all.
    const cohost = buildCameraLink('http://localhost:5173/', {
      hostId: 'p',
      token: 'q',
      role: 'cohost',
    })
    expect(new URL(cohost).searchParams.get('role')).toBeNull()
    expect(parseCameraLink(cohost)?.role).toBe('cohost')

    const camera = buildCameraLink('http://localhost:5173/', {
      hostId: 'p',
      token: 'q',
      role: 'camera',
    })
    expect(new URL(camera).searchParams.get('role')).toBe('camera')
    expect(parseCameraLink(camera)).toEqual({ hostId: 'p', token: 'q', role: 'camera' })
  })

  it('takes an unknown or absent role for a co-host', () => {
    // Another door's role must never read as a capability nobody checked: the
    // token is what the host verifies, and the phone page decides from this.
    expect(parseRole(null)).toBe('cohost')
    expect(parseRole('')).toBe('cohost')
    expect(parseRole('cameraman')).toBe('cohost')
    expect(parseRole('camera')).toBe('camera')
    expect(parseCameraLink('https://example.com/app.html?camera=p&t=q&role=wat')?.role).toBe(
      'cohost',
    )
  })

  it('stays on the studio page inside the app sub-path and replaces a stale session', () => {
    const link = buildCameraLink(
      'https://spuds0588.github.io/open-telestrator/app.html?camera=stale&t=stale',
      { hostId: 'p', token: 'q' },
    )
    expect(link.startsWith('https://spuds0588.github.io/open-telestrator/app.html?')).toBe(true)
    expect(parseCameraLink(link)).toEqual({ hostId: 'p', token: 'q', role: 'cohost' })
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
