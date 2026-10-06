/**
 * The control sidebar is one rail plus one panel, not eight stacked groups.
 *
 * The rail is always visible; the panel in front of it shows whichever group is
 * open. Everything here is the part of that arrangement that can be reasoned
 * about without a browser: which panels exist, in what order, and the single
 * fact worth knowing about a panel *while it is closed* — how many inputs are
 * live, whether a co-host has joined, whether the program is on air.
 *
 * The corner camera (the picture-in-picture overlay) has no panel of its own:
 * it belongs to the inputs, and lives at the bottom of the **Input** panel.
 */

import type { MicStatus } from './audio'
import type { BroadcastStatus } from './useBroadcast'
import type { ControlMode } from './controlMode'

/**
 * `control` exists only in the desktop build. It is in the union rather than
 * being handled with a cast because the rail, the icon map and the badge rule
 * are all keyed by it: leaving it out is what makes "the web build has seven
 * tiles" a fact the compiler knows rather than a comment.
 */
export type PanelId =
  | 'control'
  | 'draw'
  | 'input'
  | 'audio'
  | 'replay'
  | 'cohosts'
  | 'broadcast'
  | 'hardware'

export interface PanelSpec {
  id: PanelId
  label: string
  /** Utilities sit below the divider, against the bottom of the rail. */
  utility?: boolean
}

/**
 * The desktop roster: Control sits above Draw, because whether the pointer draws
 * at all comes before what it draws with.
 *
 * `PANELS` stays the web roster — the browser has no way to pass a click to the
 * page underneath, so it has no Control mode to offer — and the studio asks for
 * `desktopPanels(isDesktop)` instead of reading `PANELS` directly.
 */
export function desktopPanels(isDesktop: boolean): PanelSpec[] {
  if (!isDesktop) return PANELS
  return [{ id: 'control', label: 'Control' }, ...PANELS]
}

/** Main panels first, utilities last — the order the rail renders them in. */
export const PANELS: PanelSpec[] = [
  { id: 'draw', label: 'Draw' },
  { id: 'input', label: 'Input' },
  { id: 'audio', label: 'Audio' },
  { id: 'replay', label: 'Replay' },
  { id: 'cohosts', label: 'Co-hosts' },
  { id: 'broadcast', label: 'Broadcast' },
  { id: 'hardware', label: 'Hardware', utility: true },
]

/** The panel the studio opens on: adding the first input is always step one. */
export const DEFAULT_PANEL: PanelId = 'input'

export type BadgeTone = 'count' | 'live' | 'ok' | 'warn'

export interface PanelBadge {
  text: string
  tone: BadgeTone
}

/** Everything a badge can be derived from, gathered from the live controllers. */
export interface PanelStatus {
  /** Live inputs on the stage (screen, cameras, files, co-host cameras). */
  inputs: number
  /** Announcer mic: a hot mic is worth seeing from outside the panel. */
  mic: MicStatus
  replaying: boolean
  /** Connected co-hosts, whether or not they are streaming a camera. */
  cohosts: number
  broadcasting: BroadcastStatus
  viewers: number
  gamepads: number
  /** Only the desktop build has a mode to report; the web build leaves it out. */
  mode?: ControlMode
}

/**
 * The badge a closed panel wears on the rail — one number or word, never a
 * bare grey title. `null` means the panel has nothing to report and stays
 * quiet, which is the common case.
 */
export function panelBadge(id: PanelId, status: PanelStatus): PanelBadge | null {
  switch (id) {
    // An empty input list is the one state worth nagging about: nothing can
    // go on the program until an input is added.
    case 'input':
      return status.inputs > 0
        ? { text: String(status.inputs), tone: 'count' }
        : { text: '!', tone: 'warn' }
    case 'audio':
      return status.mic === 'on' ? { text: 'mic', tone: 'ok' } : null
    case 'replay':
      return status.replaying ? { text: '0.5×', tone: 'warn' } : null
    case 'cohosts':
      return status.cohosts > 0 ? { text: String(status.cohosts), tone: 'ok' } : null
    case 'broadcast':
      if (status.broadcasting === 'live') {
        return { text: `${status.viewers}`, tone: 'live' }
      }
      return status.broadcasting === 'opening' ? { text: '…', tone: 'warn' } : null
    case 'hardware':
      return status.gamepads > 0 ? { text: String(status.gamepads), tone: 'count' } : null
    // A mode you cannot see is a mode you will be stuck in, so a closed panel
    // says when the pointer is not drawing.
    case 'control':
      return status.mode === 'control' ? { text: 'ctrl', tone: 'warn' } : null
    // Drawing is already on screen; a badge would only be noise.
    case 'draw':
      return null
  }
}
