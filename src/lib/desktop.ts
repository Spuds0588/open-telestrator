/**
 * The only place the app knows it is running inside a desktop shell.
 *
 * Two rules keep the web build honest. First, nothing else in `src/lib` may
 * test for the shell: everything else asks these functions, so the browser keeps
 * behaving identically and its tests keep proving it. Second, the shell's API is
 * imported *lazily* rather than at the top of the module, so `@tauri-apps/api`
 * never reaches the Pages bundle — when none of this is called, none of it is
 * downloaded.
 *
 * Every function here is safe to call in a browser: they report failure rather
 * than throwing, because "there is no shell" is the normal case on the web.
 */

import { isMobileUserAgent, type ShellMode } from './touch'
import { RELEASES_API, isNewer, releaseFromApi, type UpdateState } from './updates'

/**
 * Whether we are inside the desktop shell.
 *
 * Tauri injects this object before any app code runs, so it is present by the
 * time the first component mounts and never appears in a browser.
 */
export function isDesktop(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}

/** The shell's `invoke`, or null in a browser. */
async function invoke<T>(command: string, args?: unknown): Promise<T | null> {
  if (!isDesktop()) return null
  try {
    const { invoke: call } = await import('@tauri-apps/api/core')
    return (await call<T>(command, args as never)) as T
  } catch (error) {
    console.warn(`The desktop shell refused ${command}:`, error)
    return null
  }
}

// --- control mode ----------------------------------------------------------

/** Put the window into Draw or Control mode. Returns the mode actually set. */
export async function setControlMode(control: boolean): Promise<boolean | null> {
  return invoke<boolean>('control_set', { control })
}

export async function getControlMode(): Promise<boolean | null> {
  return invoke<boolean>('control_get')
}

/**
 * Hear about a mode change made anywhere — the rail's switch, the global
 * shortcut, or the tray icon. Returns an unsubscribe function, which is a no-op
 * in a browser.
 */
export async function onControlMode(listener: (control: boolean) => void): Promise<() => void> {
  if (!isDesktop()) return () => {}
  try {
    const { listen } = await import('@tauri-apps/api/event')
    return await listen<boolean>('control-changed', (event) => listener(event.payload))
  } catch (error) {
    console.warn('Could not watch the window mode:', error)
    return () => {}
  }
}

// --- stream out ------------------------------------------------------------

export interface StreamSettings {
  url: string
  key: string
  width: number
  height: number
  frameRate: number
  audioSampleRate: number
  audioChannels: number
}

/**
 * Connect and start publishing. Resolves only once the platform has accepted
 * the stream, and rejects with the reason when it does not — a bad key is a
 * synchronous answer, not something to poll for.
 */
export async function streamStart(settings: StreamSettings): Promise<string | null> {
  if (!isDesktop()) return 'Streaming out needs the desktop app.'
  try {
    const { invoke: call } = await import('@tauri-apps/api/core')
    // Tauri's argument type wants an index signature; a plain interface does not
    // have one, and the shell deserialises the fields by name either way.
    await call('stream_start', settings as unknown as Record<string, unknown>)
    return null
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
  }
}

/**
 * Hand over one encoded frame.
 *
 * Sent as a raw body rather than as an argument: a `Uint8Array` in a normal
 * argument would arrive as an array of numbers, five bytes of JSON for every
 * byte of video.
 */
export async function streamFrame(frame: Uint8Array): Promise<void> {
  if (!isDesktop()) return
  try {
    const { invoke: call } = await import('@tauri-apps/api/core')
    await call('stream_frame', frame)
  } catch (error) {
    // A frame failing to cross is not worth tearing the broadcast down over:
    // the status poll is what notices a stream that has really died.
    console.warn('A frame did not reach the publisher:', error)
  }
}

export async function streamStop(): Promise<void> {
  await invoke('stream_stop')
}

/** The reason the stream ended, or null while it is healthy. */
export async function streamFailure(): Promise<string | null> {
  return invoke<string | null>('stream_failure')
}

// --- which shell -----------------------------------------------------------

/**
 * Which shell is hosting the studio: a browser, a desktop window, or a phone.
 *
 * The user agent is what separates the last two — Tauri injects the same
 * internals object into both — and `touch.ts` owns the rule.
 */
export function shellMode(): ShellMode {
  if (!isDesktop()) return 'browser'
  return isMobileUserAgent(navigator.userAgent) ? 'mobile' : 'desktop'
}

/** The platform and version, for the update prompt's "you have …" line. */
export async function appVersion(): Promise<string | null> {
  if (!isDesktop()) return null
  try {
    const { getVersion } = await import('@tauri-apps/api/app')
    return await getVersion()
  } catch (error) {
    console.warn('Could not read the app version:', error)
    return null
  }
}

// --- updates ---------------------------------------------------------------

/**
 * Ask GitHub whether there is a newer release than the one running.
 *
 * The app is a standalone executable, so there is nothing to install in place:
 * a newer version is news and a link, not a download this process performs. See
 * `RELEASES_API` in `updates.ts` for why the API is asked rather than a signed
 * manifest.
 *
 * `unreachable` covers everything that is not an answer: no shell to ask, no
 * release published yet, no network. The caller reports it only when the
 * operator asked for a check — never as a reason to interrupt.
 */
export async function checkForUpdate(): Promise<UpdateState> {
  if (!isDesktop()) return { kind: 'unreachable' }
  try {
    // Without a version of our own there is nothing to compare against, and a
    // prompt offering to "upgrade" to whatever the tag says is worse than quiet.
    const current = await appVersion()
    if (!current) return { kind: 'unreachable' }

    const response = await fetch(RELEASES_API, { headers: { Accept: 'application/vnd.github+json' } })
    if (!response.ok) return { kind: 'unreachable' }
    const release = releaseFromApi(await response.json())
    if (!release) return { kind: 'unreachable' }
    if (!isNewer(release.version, current)) return { kind: 'current' }

    return {
      kind: 'available',
      version: release.version.replace(/^v/i, ''),
      notes: release.notes,
      url: release.url,
    }
  } catch (error) {
    console.warn('Could not check for a new version:', error)
    return { kind: 'unreachable' }
  }
}

/**
 * Open the release page in the system's browser — the *only* thing this app does
 * about a new version. Returns the reason it could not, or null.
 *
 * The webview navigates nowhere itself: an address the operator can see, in the
 * browser they already trust, is the honest way to hand over a binary.
 */
export async function openReleases(url: string): Promise<string | null> {
  if (!isDesktop()) return 'Opening the download page needs the desktop app.'
  try {
    const { openUrl } = await import('@tauri-apps/plugin-opener')
    await openUrl(url)
    return null
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
  }
}

/**
 * Hear the tray's **Check for updates**, which exists because a window in
 * Control mode cannot be clicked. Returns a no-op unsubscribe in a browser.
 */
export async function onUpdateCheckRequested(listener: () => void): Promise<() => void> {
  if (!isDesktop()) return () => {}
  try {
    const { listen } = await import('@tauri-apps/api/event')
    return await listen('update-check', () => listener())
  } catch (error) {
    console.warn('Could not watch for an update request:', error)
    return () => {}
  }
}
