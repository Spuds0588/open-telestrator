import { describe, expect, it } from 'vitest'
import {
  MUTE_KEY,
  NOTES_LIMIT,
  RELEASES_API,
  RELEASES_PAGE,
  isNewer,
  releaseFromApi,
  notesSummary,
  parseVersion,
  quietMessage,
  readMuted,
  shouldPrompt,
  writeMuted,
  type PreferenceStore,
  type UpdateState,
} from './updates'

/** A `localStorage` that only remembers what it was told. */
function store(initial: Record<string, string> = {}): PreferenceStore & { value: Record<string, string> } {
  const value = { ...initial }
  return {
    value,
    getItem: (key) => value[key] ?? null,
    setItem: (key, next) => {
      value[key] = next
    },
  }
}

const available: UpdateState = {
  kind: 'available',
  version: '0.2.0',
  notes: null,
  url: 'https://github.com/Spuds0588/open-telestrator/releases/tag/v0.2.0',
}

describe('versions', () => {
  it('reads a version a release might be tagged with', () => {
    expect(parseVersion('0.2.0')).toEqual([0, 2, 0])
    expect(parseVersion('v1.2.3')).toEqual([1, 2, 3])
    expect(parseVersion('  2.10  ')).toEqual([2, 10])
    expect(parseVersion('1.2.3+build.5')).toEqual([1, 2, 3])
  })

  it('refuses anything that is not a version', () => {
    expect(parseVersion('')).toBeNull()
    expect(parseVersion('v')).toBeNull()
    expect(parseVersion('latest')).toBeNull()
    expect(parseVersion('1.2.x')).toBeNull()
    expect(parseVersion('1.-2.3')).toBeNull()
  })

  it('treats a pre-release as the release it is numbered after', () => {
    // 1.2.3-rc.1 is not an upgrade to 1.2.3, and this project publishes no
    // pre-releases, so the suffix is not compared.
    expect(isNewer('1.2.3-rc.1', '1.2.3')).toBe(false)
  })

  it('compares numerically, not as strings', () => {
    expect(isNewer('0.10.0', '0.9.0')).toBe(true)
    expect(isNewer('0.9.0', '0.10.0')).toBe(false)
    expect(isNewer('2.0.0', '1.99.99')).toBe(true)
  })

  it('counts a longer version as the newer one', () => {
    expect(isNewer('1.2.1', '1.2')).toBe(true)
    expect(isNewer('1.2', '1.2.0')).toBe(false)
    expect(isNewer('1.2.0', '1.2')).toBe(false)
  })

  it('never offers a version it cannot compare', () => {
    // The failure that matters: an unreadable tag must not nag forever.
    expect(isNewer('nightly', '0.1.0')).toBe(false)
    expect(isNewer('0.2.0', 'nightly')).toBe(false)
  })

  it('says no when the versions are the same', () => {
    expect(isNewer('0.1.0', '0.1.0')).toBe(false)
    expect(isNewer('v0.1.0', '0.1.0')).toBe(false)
  })
})

describe('release notes', () => {
  it('shows nothing when there is nothing to show', () => {
    expect(notesSummary(null)).toBeNull()
    expect(notesSummary(undefined)).toBeNull()
    expect(notesSummary('   ')).toBeNull()
    expect(notesSummary('## \n\n**')).toBeNull()
  })

  it('flattens markdown into one readable line', () => {
    expect(notesSummary('## What is new\n\n- rtmps support\n- *faster* undo')).toBe(
      'What is new - rtmps support - faster undo',
    )
  })

  it('keeps an underscore that is part of a name, not emphasis', () => {
    // The release notes name the assets: `x86_64` is not italic markdown.
    expect(notesSummary('**Linux (x86_64)** — checked')).toBe('Linux (x86_64) — checked')
  })

  it('cuts a long changelog rather than growing the prompt', () => {
    const long = 'a'.repeat(NOTES_LIMIT * 2)
    const summary = notesSummary(long)
    expect(summary).toHaveLength(NOTES_LIMIT + 1)
    expect(summary?.endsWith('…')).toBe(true)
    // A short one is passed through whole.
    expect(notesSummary('a short note')).toBe('a short note')
  })

  it('honours its own limit argument', () => {
    expect(notesSummary('abcdefghij', 4)).toBe('abcd…')
  })
})

describe('the opt-out', () => {
  it('notifies by default', () => {
    expect(readMuted(store())).toBe(false)
    expect(readMuted(null)).toBe(false)
  })

  it('remembers a refusal across launches', () => {
    const memory = store()
    writeMuted(memory, true)
    expect(memory.value[MUTE_KEY]).toBe('off')
    expect(readMuted(memory)).toBe(true)
    // And it is a switch, not a one-way door.
    writeMuted(memory, false)
    expect(readMuted(memory)).toBe(false)
  })

  it('reads anything that is not a stored refusal as a yes', () => {
    expect(readMuted(store({ [MUTE_KEY]: 'on' }))).toBe(false)
    expect(readMuted(store({ [MUTE_KEY]: '' }))).toBe(false)
    // A value written by a future version must not silence the app.
    expect(readMuted(store({ [MUTE_KEY]: 'later' }))).toBe(false)
  })

  it('survives storage that throws', () => {
    const broken: PreferenceStore = {
      getItem: () => {
        throw new Error('storage is disabled')
      },
      setItem: () => {
        throw new Error('storage is disabled')
      },
    }
    expect(readMuted(broken)).toBe(false)
    expect(() => writeMuted(broken, true)).not.toThrow()
  })
})

describe('the prompt', () => {
  it('interrupts about an update unless it was told not to', () => {
    expect(shouldPrompt(available, { muted: false, manual: false })).toBe(true)
    expect(shouldPrompt(available, { muted: true, manual: false })).toBe(false)
  })

  it('answers a check the operator asked for, muted or not', () => {
    // The tray's Check for updates is a manual check: it always answers.
    expect(shouldPrompt(available, { muted: true, manual: true })).toBe(true)
    expect(shouldPrompt({ kind: 'current' }, { muted: true, manual: true })).toBe(true)
    expect(shouldPrompt({ kind: 'unreachable' }, { muted: false, manual: true })).toBe(true)
  })

  it('never says "you are up to date" unasked', () => {
    expect(shouldPrompt({ kind: 'current' }, { muted: false, manual: false })).toBe(false)
    expect(shouldPrompt({ kind: 'unreachable' }, { muted: false, manual: false })).toBe(false)
  })

  it('has one sentence per quiet outcome', () => {
    expect(quietMessage({ kind: 'current' }, '0.1.0')).toContain('0.1.0')
    expect(quietMessage({ kind: 'unreachable' }, '0.1.0')).not.toBe(
      quietMessage({ kind: 'current' }, '0.1.0'),
    )
  })
})

describe('the release feed', () => {
  it('points at this repository over https', () => {
    expect(RELEASES_API.startsWith('https://api.github.com/repos/Spuds0588/open-telestrator/')).toBe(
      true,
    )
    expect(RELEASES_PAGE).toBe('https://github.com/Spuds0588/open-telestrator/releases')
  })

  it('reads the three things worth having out of a release', () => {
    const release = releaseFromApi({
      tag_name: 'v0.2.0',
      body: 'Camera links remember their pairing now.',
      html_url: 'https://github.com/Spuds0588/open-telestrator/releases/tag/v0.2.0',
      draft: false,
    })
    expect(release).toEqual({
      version: 'v0.2.0',
      notes: 'Camera links remember their pairing now.',
      url: 'https://github.com/Spuds0588/open-telestrator/releases/tag/v0.2.0',
    })
  })

  it('says nothing about a draft, which is the point of a draft', () => {
    expect(releaseFromApi({ tag_name: 'v0.2.0', draft: true })).toBeNull()
  })

  it('refuses a payload it cannot name a version from', () => {
    // The failure that matters: an unrecognised shape must not become a prompt
    // offering to upgrade somebody to something unnameable.
    expect(releaseFromApi(null)).toBeNull()
    expect(releaseFromApi('a string')).toBeNull()
    expect(releaseFromApi({})).toBeNull()
    expect(releaseFromApi({ tag_name: 'nightly' })).toBeNull()
    expect(releaseFromApi({ tag_name: '  ' })).toBeNull()
  })

  it('falls back to the releases page when a release has no url of its own', () => {
    expect(releaseFromApi({ tag_name: '1.0.0' })?.url).toBe(RELEASES_PAGE)
    expect(releaseFromApi({ tag_name: '1.0.0', body: null })?.notes).toBeNull()
  })
})
