import { describe, expect, it } from 'vitest'
import { DEFAULT_PANEL, PANELS, desktopPanels, panelBadge, type PanelStatus } from './panels'

const quiet: PanelStatus = {
  inputs: 0,
  mic: 'idle',
  replaying: false,
  cohosts: 0,
  broadcasting: 'idle',
  viewers: 0,
  gamepads: 0,
}

const status = (over: Partial<PanelStatus>): PanelStatus => ({ ...quiet, ...over })

describe('PANELS', () => {
  it('lists the seven groups with the utilities last', () => {
    expect(PANELS.map((panel) => panel.id)).toEqual([
      'draw',
      'input',
      'audio',
      'replay',
      'cohosts',
      'broadcast',
      'hardware',
    ])
    expect(PANELS.filter((panel) => panel.utility).map((panel) => panel.id)).toEqual(['hardware'])
  })

  it('gives every panel a distinct label', () => {
    expect(new Set(PANELS.map((panel) => panel.label)).size).toBe(PANELS.length)
  })

  it('opens on a panel that exists', () => {
    expect(PANELS.some((panel) => panel.id === DEFAULT_PANEL)).toBe(true)
  })
})

describe('desktopPanels', () => {
  it('leaves the web build with exactly the seven tiles it has always had', () => {
    expect(desktopPanels(false).map((panel) => panel.id)).toEqual(PANELS.map((panel) => panel.id))
    expect(desktopPanels(false).some((panel) => panel.id === 'control')).toBe(false)
  })

  it('puts Control at the head, above Draw', () => {
    // Whether the pointer draws at all comes before what it draws with.
    const panels = desktopPanels(true)
    expect(panels[0]?.id).toBe('control')
    expect(panels.map((panel) => panel.id)).toEqual(['control', ...PANELS.map((panel) => panel.id)])
  })

  it('keeps Control with the main panels rather than the utilities', () => {
    expect(desktopPanels(true).find((panel) => panel.id === 'control')?.utility).toBeUndefined()
  })

  it('still opens on a panel both rosters have', () => {
    expect(desktopPanels(true).some((panel) => panel.id === DEFAULT_PANEL)).toBe(true)
  })

  it('does not mutate the web roster', () => {
    desktopPanels(true)
    expect(PANELS.map((panel) => panel.id)).not.toContain('control')
  })
})

describe('panelBadge', () => {
  it('stays quiet when nothing is happening', () => {
    for (const panel of PANELS) {
      if (panel.id === 'input') continue
      expect(panelBadge(panel.id, quiet)).toBeNull()
    }
  })

  it('says on the rail when the pointer is not drawing', () => {
    // Null rather than silent: a mode you cannot see is a mode you get stuck in.
    expect(panelBadge('control', quiet)).toBeNull()
    expect(panelBadge('control', status({ mode: 'draw' }))).toBeNull()
    expect(panelBadge('control', status({ mode: 'control' }))).toEqual({
      text: 'ctrl',
      tone: 'warn',
    })
  })

  it('flags an input list that is still empty', () => {
    expect(panelBadge('input', quiet)).toEqual({ text: '!', tone: 'warn' })
  })

  it('counts the live inputs', () => {
    expect(panelBadge('input', status({ inputs: 3 }))).toEqual({ text: '3', tone: 'count' })
  })

  it('shows a hot mic, a replay and connected co-hosts', () => {
    expect(panelBadge('audio', status({ mic: 'on' }))).toEqual({ text: 'mic', tone: 'ok' })
    expect(panelBadge('audio', status({ mic: 'denied' }))).toBeNull()
    expect(panelBadge('audio', status({ mic: 'idle' }))).toBeNull()
    expect(panelBadge('replay', status({ replaying: true }))).toEqual({ text: '0.5×', tone: 'warn' })
    expect(panelBadge('cohosts', status({ cohosts: 2 }))).toEqual({ text: '2', tone: 'ok' })
  })

  it('goes red with the viewer count while on air', () => {
    expect(panelBadge('broadcast', status({ broadcasting: 'live', viewers: 4 }))).toEqual({
      text: '4',
      tone: 'live',
    })
    expect(panelBadge('broadcast', status({ broadcasting: 'live', viewers: 0 }))).toEqual({
      text: '0',
      tone: 'live',
    })
  })

  it('waits while connecting and stays quiet when off air', () => {
    expect(panelBadge('broadcast', status({ broadcasting: 'opening' }))).toEqual({
      text: '…',
      tone: 'warn',
    })
    expect(panelBadge('broadcast', quiet)).toBeNull()
  })

  it('counts gamepads but never badges the drawing', () => {
    expect(panelBadge('hardware', status({ gamepads: 1 }))).toEqual({ text: '1', tone: 'count' })
    expect(panelBadge('draw', status({ inputs: 9 }))).toBeNull()
  })
})
