import { describe, expect, it } from 'vitest'
import {
  DEFAULT_MODE,
  bodyClass,
  canDraw,
  hint,
  label,
  offersControlMode,
  shortcutLabel,
  toggle,
} from './controlMode'

describe('control mode', () => {
  it('draws by default', () => {
    expect(DEFAULT_MODE).toBe('draw')
    expect(canDraw(DEFAULT_MODE)).toBe(true)
  })

  it('toggles both ways, so the switch is never one-way', () => {
    expect(toggle('draw')).toBe('control')
    expect(toggle('control')).toBe('draw')
    // And an even number of toggles is where you started.
    expect(toggle(toggle('draw'))).toBe('draw')
  })

  it('stops drawing in control mode', () => {
    expect(canDraw('control')).toBe(false)
  })

  it('labels and explains each mode distinctly', () => {
    expect(label('draw')).toBe('Draw')
    expect(label('control')).toBe('Control')
    expect(hint('draw')).not.toBe(hint('control'))
    // The hint about Control says where the pointer goes, which is the whole
    // point of the mode.
    expect(hint('control').toLowerCase()).toContain('under')
  })

  it('only marks the body in control mode', () => {
    expect(bodyClass('draw')).toBe('')
    expect(bodyClass('control')).toBe('control')
  })

  it('prints the shortcut the platform actually uses', () => {
    expect(shortcutLabel('MacIntel')).toBe('Cmd+Shift+D')
    expect(shortcutLabel('macOS')).toBe('Cmd+Shift+D')
    expect(shortcutLabel('Linux x86_64')).toBe('Ctrl+Shift+D')
    expect(shortcutLabel('Win32')).toBe('Ctrl+Shift+D')
  })

  it('only offers the mode where the window can pass clicks through', () => {
    expect(offersControlMode(true)).toBe(true)
    expect(offersControlMode(false)).toBe(false)
  })
})
