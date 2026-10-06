import { useCallback, useEffect, useRef, useState } from 'react'
import { appVersion, checkForUpdate, onUpdateCheckRequested, openReleases, shellMode } from './desktop'
import { notesSummary, quietMessage, readMuted, shouldPrompt, writeMuted } from './updates'

/**
 * What the prompt is showing, or what the operator asked for and did not get.
 *
 * `quiet` is only ever the answer to a check they started themselves: nobody
 * wants to be told, unprompted, that they are up to date.
 */
export type UpdateNotice =
  | { kind: 'available'; version: string; current: string | null; notes: string | null; url: string }
  | { kind: 'quiet'; text: string }

export interface UpdateController {
  notice: UpdateNotice | null
  /** While a check is in flight, and briefly while a browser is being opened. */
  phase: 'idle' | 'checking' | 'opening'
  /** Why nothing happened, if something went wrong. */
  failure: string | null
  /** Whether new versions should stop being announced. Persisted. */
  muted: boolean
  setMuted: (muted: boolean) => void
  /** Ask now. Always answers, even when announcements are switched off. */
  check: () => void
  /** Hand the release page to the system's browser. */
  open: () => void
  dismiss: () => void
}

/** Long enough not to compete with a capture or a connection at startup. */
const STARTUP_DELAY_MS = 4000

/**
 * Whether a newer release is something this build can act on.
 *
 * A phone is a real shell, so asking whether we are in one is not the question:
 * a release carries desktop executables, and pointing a phone at them would hand
 * it the wrong file — an APK is updated through a store or a sideload. The tray's
 * manual check is absent on a phone too, so there would be no way back for an
 * operator who had muted the prompt. `desktop.ts` owns the shape and answers it.
 */
function canBeUpdated(): boolean {
  return shellMode() === 'desktop'
}

function storage(): Storage | null {
  try {
    return window.localStorage ?? null
  } catch {
    // Storage can be denied outright; the preference then lives for one launch.
    return null
  }
}

/**
 * News of a newer version, as the studio drives it.
 *
 * Nothing is downloaded and nothing is installed: the app is a standalone
 * executable, so a check ends in a link the opener plugin hands to the system's
 * browser. The asking is `desktop.ts`. What is decided here is *whether the
 * operator is interrupted* — the one thing about an update prompt people have
 * strong feelings about — and that decision is `shouldPrompt` in `updates.ts`,
 * with the answer kept in `localStorage` so it survives a restart.
 *
 * The tray's **Check for updates** arrives as an event from the shell and counts
 * as a manual check: it answers even when announcements are off, which is also
 * how somebody who muted the prompt finds their way back to it.
 *
 * Ticking the opt-out does **not** take the prompt away mid-sentence. It stops
 * the next one, and the one after that — a dialog that vanishes the moment it is
 * answered cannot be unticked by anybody who changes their mind.
 */
export function useUpdates(): UpdateController {
  const [notice, setNotice] = useState<UpdateNotice | null>(null)
  const [phase, setPhase] = useState<UpdateController['phase']>('idle')
  const [failure, setFailure] = useState<string | null>(null)
  const [muted, setMutedState] = useState(() => readMuted(storage()))
  const [current, setCurrent] = useState<string | null>(null)

  // Read inside callbacks that must not be rebuilt when an answer changes.
  const mutedRef = useRef(muted)
  mutedRef.current = muted
  const currentRef = useRef(current)
  currentRef.current = current
  const checkingRef = useRef(false)

  const setMuted = useCallback((next: boolean) => {
    setMutedState(next)
    writeMuted(storage(), next)
  }, [])

  const runCheck = useCallback(async (manual: boolean) => {
    if (checkingRef.current) return
    checkingRef.current = true
    if (manual) setPhase('checking')
    setFailure(null)

    const known = currentRef.current
    const [state, version] = await Promise.all([
      checkForUpdate(),
      known ? Promise.resolve(known) : appVersion(),
    ])
    checkingRef.current = false
    setPhase('idle')
    if (version) {
      currentRef.current = version
      setCurrent(version)
    }

    // One rule for both kinds of check: an interruption only happens when the
    // preference allows it, and a check the operator asked for always answers.
    if (!shouldPrompt(state, { muted: mutedRef.current, manual })) return

    if (state.kind === 'available') {
      setNotice({
        kind: 'available',
        version: state.version,
        current: version ?? null,
        notes: notesSummary(state.notes),
        url: state.url,
      })
      return
    }
    setNotice({ kind: 'quiet', text: quietMessage(state, version ?? '') })
  }, [])

  // The startup check: once, a few seconds in, and silent about everything
  // except a newer version. It never re-runs, however the studio re-renders.
  useEffect(() => {
    if (!canBeUpdated()) return
    const timer = window.setTimeout(() => void runCheck(false), STARTUP_DELAY_MS)
    return () => window.clearTimeout(timer)
  }, [runCheck])

  // The tray, for the one case a window cannot help with: Control mode.
  useEffect(() => {
    if (!canBeUpdated()) return
    let dispose: (() => void) | null = null
    void onUpdateCheckRequested(() => void runCheck(true)).then((off) => {
      dispose = off
    })
    return () => dispose?.()
  }, [runCheck])

  const open = useCallback(() => {
    const url = notice?.kind === 'available' ? notice.url : null
    if (!url) return
    void (async () => {
      setPhase('opening')
      setFailure(null)
      const problem = await openReleases(url)
      setPhase('idle')
      if (problem) setFailure(problem)
    })()
  }, [notice])

  return {
    notice,
    phase,
    failure,
    muted,
    setMuted,
    check: useCallback(() => void runCheck(true), [runCheck]),
    open,
    dismiss: useCallback(() => setNotice(null), []),
  }
}
