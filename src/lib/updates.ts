/**
 * The update check, as rules rather than as a prompt.
 *
 * Three things here are worth being able to reason about without a shell: which
 * release counts as newer, what the operator is told, and whether we are allowed
 * to interrupt them at all. The last one is the interesting one — the notification
 * is a nuisance by design, so there is one switch that turns it off for good, and
 * it must survive a restart. Getting that flag wrong is how an app teaches people
 * to ignore it, so it is stored under a key that says exactly what it means.
 *
 * Nothing here touches the network or the shell: `desktop.ts` does that, and
 * hands the answer to these functions.
 */

/**
 * Where the newest published release is asked about.
 *
 * The GitHub API rather than the updater plugin's signed manifest: this app
 * ships as a standalone executable, so there is no installer for the updater to
 * run and nothing for its signature to guard. The API answers one question — is
 * there a newer release, and what does it say — and the answer is a link.
 *
 * Unauthenticated, so it is rate-limited to 60 an hour per address. One check per
 * launch is nowhere near that, and the response carries `Access-Control-Allow-
 * Origin: *`, so it needs no proxy and no plugin.
 */
export const RELEASES_API = 'https://api.github.com/repos/Spuds0588/open-telestrator/releases/latest'

/** Where a human goes instead. Printed in the prompt, and opened on request. */
export const RELEASES_PAGE = 'https://github.com/Spuds0588/open-telestrator/releases'

/**
 * What the shell found.
 *
 * `available` is the only one worth interrupting anybody for; the other two are
 * answers to a check the operator asked for themselves, so they are shown
 * quietly and never on startup.
 */
export type UpdateState =
  | { kind: 'available'; version: string; notes: string | null; url: string }
  | { kind: 'current' }
  | { kind: 'unreachable' }

/**
 * The release as GitHub describes it, read into the three things worth having.
 *
 * `null` for anything that is not a release with a version — a draft, a payload
 * whose shape has changed, a tag that is not a number — because the alternative
 * is a prompt offering to upgrade somebody to a version we cannot name.
 */
export function releaseFromApi(payload: unknown): { version: string; notes: string | null; url: string } | null {
  if (!payload || typeof payload !== 'object') return null
  const release = payload as Record<string, unknown>
  // Drafts are invisible to everybody else, so announce nothing about them.
  if (release.draft === true) return null
  const tag = typeof release.tag_name === 'string' ? release.tag_name : ''
  const version = tag.trim()
  if (!parseVersion(version)) return null
  const body = typeof release.body === 'string' ? release.body : null
  const url = typeof release.html_url === 'string' ? release.html_url : RELEASES_PAGE
  return { version, notes: body, url }
}

/** The stored preference, in the shape `localStorage` actually has. */
export interface PreferenceStore {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

/**
 * The key. Versioned-looking on purpose: it is the app's storage, not the
 * update's, and a rename later would silently re-nag everyone.
 */
export const MUTE_KEY = 'open-telestrator.updates.notify'

/**
 * Whether the operator has asked not to be told again.
 *
 * Anything other than the literal `off` means "tell me": an absent key on a
 * first run, and a value written by some future version, both have to resolve
 * to the friendlier answer rather than to permanent silence.
 */
export function readMuted(store: PreferenceStore | null): boolean {
  if (!store) return false
  try {
    return store.getItem(MUTE_KEY) === 'off'
  } catch {
    return false
  }
}

export function writeMuted(store: PreferenceStore | null, muted: boolean): void {
  if (!store) return
  try {
    store.setItem(MUTE_KEY, muted ? 'off' : 'on')
  } catch {
    // A browser with storage disabled still gets the prompt this session; it
    // just forgets the answer, which is the safe way to fail.
  }
}

/**
 * A version as a list of numbers, or `null` when it is not one.
 *
 * Only the numeric release part is read, so `1.2.3`, `v1.2.3` and `1.2.3-rc.1`
 * all parse — and the last one parses *equal* to `1.2.3` on purpose. A
 * pre-release is not an upgrade to the release of the same number, and a
 * prerelease tag is a shape this project does not publish.
 */
export function parseVersion(value: string): number[] | null {
  const trimmed = value.trim().replace(/^v/i, '')
  const numeric = trimmed.split(/[-+]/)[0] ?? ''
  if (!numeric) return null
  const parts = numeric.split('.')
  const numbers: number[] = []
  for (const part of parts) {
    // No leading-zero games and no floats: `1.2.3.4` is read, `1.2.x` is not.
    if (!/^\d+$/.test(part)) return null
    numbers.push(Number(part))
  }
  return numbers
}

/** Whether `latest` is a version a running `current` should move to. */
export function isNewer(latest: string, current: string): boolean {
  const left = parseVersion(latest)
  const right = parseVersion(current)
  // An unreadable version is not an upgrade. The check stays quiet rather than
  // offering something it cannot compare, which is the failure that would nag
  // forever.
  if (!left || !right) return false
  const length = Math.max(left.length, right.length)
  for (let index = 0; index < length; index += 1) {
    const a = left[index] ?? 0
    const b = right[index] ?? 0
    if (a !== b) return a > b
  }
  return false
}

/** How much of a release's notes the prompt shows. */
export const NOTES_LIMIT = 320

/**
 * The release notes, flattened to one paragraph and cut to something readable.
 *
 * GitHub release bodies are Markdown with headings and links; the prompt is one
 * line of context, not a changelog viewer, so this takes the plain text and
 * stops at the limit rather than rendering it.
 */
export function notesSummary(notes: string | null | undefined, limit = NOTES_LIMIT): string | null {
  if (!notes) return null
  // Emphasis markers and heading hashes come off, but not `_`: an underscore in a
  // changelog is far more often part of a name than an italic marker, and eating it
  // turns every `x86_64` into `x8664` in the line the operator actually reads.
  const flat = notes
    .replace(/[#*>`]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  if (!flat) return null
  if (flat.length <= limit) return flat
  return `${flat.slice(0, limit).trimEnd()}…`
}

/**
 * Whether the prompt should be on screen.
 *
 * A muted operator is still allowed to ask — the tray's **Check for updates** is
 * that ask — so `manual` overrides the preference. What the preference turns off
 * is being interrupted, which is the only thing anybody objected to.
 */
export function shouldPrompt(state: UpdateState, options: { muted: boolean; manual: boolean }): boolean {
  if (state.kind !== 'available') return options.manual
  return options.manual || !options.muted
}

/** One sentence for the quiet outcomes of a check the operator asked for. */
export function quietMessage(state: UpdateState, current: string): string {
  return state.kind === 'current'
    ? `Open Telestrator ${current} is the newest version.`
    : 'Could not reach the download server. Check your connection, or open the releases page.'
}
