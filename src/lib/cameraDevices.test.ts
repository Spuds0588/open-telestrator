import { describe, expect, it } from 'vitest'
import {
  INPUT_KINDS,
  inputStatusText,
  type InputPhase,
  type SupportedInput,
} from './cameraDevices'

const KINDS: SupportedInput[] = ['screen', 'camera', 'audio']
const PHASES: InputPhase[] = ['off', 'requesting', 'live', 'problem']

describe('INPUT_KINDS', () => {
  it('offers exactly the three supported inputs once each', () => {
    expect(INPUT_KINDS.map((item) => item.kind)).toEqual(KINDS)
  })

  it('gives every input a label, hint and glyph', () => {
    for (const item of INPUT_KINDS) {
      expect(item.label.length).toBeGreaterThan(0)
      expect(item.hint.length).toBeGreaterThan(0)
      expect(item.glyph.length).toBeGreaterThan(0)
    }
  })
})

describe('inputStatusText', () => {
  it('always returns a sentence for every kind and phase', () => {
    for (const kind of KINDS) {
      for (const phase of PHASES) {
        expect(inputStatusText(kind, phase).length).toBeGreaterThan(0)
      }
    }
  })

  it('distinguishes all four phases for each kind', () => {
    for (const kind of KINDS) {
      const texts = PHASES.map((phase) => inputStatusText(kind, phase))
      expect(new Set(texts).size).toBe(PHASES.length)
    }
  })

  it('tells the host how to recover from a problem', () => {
    expect(inputStatusText('screen', 'problem')).toContain('try again')
    expect(inputStatusText('camera', 'problem')).toContain('try again')
    expect(inputStatusText('audio', 'problem')).toContain('try again')
  })
})
