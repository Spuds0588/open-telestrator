/**
 * Hardware triggers.
 *
 * A commentary desk is a pile of buttons: gamepads, USB pedals, big-button
 * boxes and MIDI pads all speak one of two browser APIs, and both are mapped
 * here onto the same actions the keyboard shortcuts use. A Stream Deck needs no
 * code at all — its software can send those keystrokes to the focused window.
 *
 * The mapping tables are pure so they can be unit-tested without hardware.
 */

export type HardwareAction =
  | 'next-source'
  | 'prev-source'
  | 'start-replay'
  | 'return-live'
  | 'undo'
  | 'clear'

/**
 * Gamepad buttons → actions, in the standard mapping (Xbox-style: A/B/X/Y,
 * bumpers, D-pad). Typical pedals and button boxes present as the first few
 * buttons, so the most important actions come first.
 */
export const GAMEPAD_BUTTONS: Readonly<Record<number, HardwareAction>> = {
  0: 'next-source', // A / cross
  1: 'prev-source', // B / circle
  2: 'start-replay', // X / square
  3: 'return-live', // Y / triangle
  4: 'undo', // L1
  5: 'clear', // R1
  12: 'prev-source', // D-pad up
  13: 'next-source', // D-pad down
  14: 'prev-source', // D-pad left
  15: 'next-source', // D-pad right
}

/**
 * The actions triggered by newly pressed buttons. Held buttons are silent:
 * a button fires once, on the edge, where the previous poll had it released.
 */
export function pressedActions(
  pressed: readonly boolean[],
  previous: readonly boolean[],
  map: Readonly<Record<number, HardwareAction>> = GAMEPAD_BUTTONS,
): HardwareAction[] {
  const actions: HardwareAction[] = []
  for (const key of Object.keys(map)) {
    const index = Number(key)
    if (pressed[index] === true && previous[index] !== true) actions.push(map[index])
  }
  return actions
}

/** MIDI notes → the same actions, for a pad or foot controller. */
export const MIDI_NOTES: Readonly<Record<number, HardwareAction>> = {
  36: 'next-source',
  37: 'prev-source',
  38: 'start-replay',
  39: 'return-live',
  40: 'undo',
  41: 'clear',
}

export function midiAction(note: number): HardwareAction | null {
  return MIDI_NOTES[note] ?? null
}

/** One line the sidebar shows so the mapping is discoverable. */
export const HARDWARE_HINT =
  'Buttons flip sources, replay, undo and clear. A Stream Deck can send the same keys: [ ] R L Z and Delete.'
