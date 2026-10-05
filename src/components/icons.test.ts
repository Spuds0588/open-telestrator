import { describe, expect, it } from 'vitest'
import { ALL_TOOLS } from '../lib/telestration'
import { PANELS } from '../lib/panels'
import { PANEL_ICONS, TOOL_ICONS } from './icons'

const unique = (values: unknown[]) => new Set(values).size === values.length

describe('PANEL_ICONS', () => {
  it('gives every panel on the rail its own glyph', () => {
    const icons = PANELS.map((panel) => PANEL_ICONS[panel.id])
    expect(icons.every(Boolean)).toBe(true)
    expect(unique(icons)).toBe(true)
  })
})

describe('TOOL_ICONS', () => {
  it('gives every drawing tool its own glyph', () => {
    const icons = ALL_TOOLS.map((tool) => TOOL_ICONS[tool])
    expect(icons.every(Boolean)).toBe(true)
    expect(unique(icons)).toBe(true)
  })
})
