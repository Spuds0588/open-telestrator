import { describe, expect, it } from 'vitest'
import {
  GAMEPAD_BUTTONS,
  MIDI_NOTES,
  pressedActions,
  midiAction,
  type HardwareAction,
} from './hardware'

describe('pressedActions', () => {
  it('fires a button once, on the edge where it goes down', () => {
    const before = [false, false, false, false]
    const down = [true, false, false, false]
    expect(pressedActions(down, before)).toEqual(['next-source'])
    // Still held: no repeat.
    expect(pressedActions(down, down)).toEqual([])
    // Released and pressed again: fires again.
    expect(pressedActions(down, [true, false, false, false])).toEqual([])
    expect(pressedActions(down, before)).toEqual(['next-source'])
  })

  it('reports every newly pressed button in index order', () => {
    const actions = pressedActions([true, true, false, true], [false, false, false, false])
    expect(actions).toEqual(['next-source', 'prev-source', 'return-live'])
  })

  it('ignores buttons outside the map, held or not', () => {
    const pressed = new Array(17).fill(false)
    pressed[6] = true
    pressed[16] = true
    expect(pressedActions(pressed, new Array(17).fill(false))).toEqual([])
  })

  it('covers every action in both maps, so each one is reachable', () => {
    const mapped = new Set<HardwareAction>([
      ...Object.values(GAMEPAD_BUTTONS),
      ...Object.values(MIDI_NOTES),
    ])
    expect(mapped).toEqual(
      new Set<HardwareAction>([
        'next-source',
        'prev-source',
        'start-replay',
        'return-live',
        'undo',
        'clear',
      ]),
    )
  })
})

describe('midiAction', () => {
  it('maps the low notes a pad or pedal sends', () => {
    expect(midiAction(36)).toBe('next-source')
    expect(midiAction(39)).toBe('return-live')
  })

  it('ignores notes it does not know', () => {
    expect(midiAction(60)).toBeNull()
    expect(midiAction(-1)).toBeNull()
  })
})
