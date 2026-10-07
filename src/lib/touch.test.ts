import { describe, expect, it } from 'vitest'
import {
  MIN_TARGET,
  PALM_WINDOW_MS,
  SIDE_RAIL_MIN_WIDTH,
  detectFormFactor,
  isPalm,
  isStylus,
  layoutFor,
  strokeWidth,
} from './touch'

/** Real user agents, because the whole rule is about telling them apart. */
const UA = {
  androidPhone:
    'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36',
  androidTablet:
    'Mozilla/5.0 (Linux; Android 13; SM-X200) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  ipad: 'Mozilla/5.0 (iPad; CPU OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/604.1',
  iphone:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1',
  linux: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
}

const layout = (userAgent: string, width: number, height: number, touch: boolean) =>
  layoutFor({ userAgent, width, height, touch })

describe('which shape of device this is', () => {
  it('reads the user agent the way the devices write it', () => {
    expect(detectFormFactor(UA.androidPhone, { width: 412, height: 915 })).toBe('phone')
    expect(detectFormFactor(UA.androidTablet, { width: 1280, height: 800 })).toBe('tablet')
    expect(detectFormFactor(UA.ipad, { width: 820, height: 1180 })).toBe('tablet')
    expect(detectFormFactor(UA.iphone, { width: 390, height: 844 })).toBe('phone')
    expect(detectFormFactor(UA.linux, { width: 1440, height: 900 })).toBe('desktop')
  })

  it('takes a silent user agent for a desktop, whatever shape the window is', () => {
    // The short side used to stand in for a phone here, because a phone shell
    // could report a desktop webview. There is no shell now, so a narrow window
    // is a narrow window: a phone in a browser always says what it is, and a
    // mouse-driven one keeps the rail it has always had.
    expect(detectFormFactor(UA.linux, { width: 412, height: 915 })).toBe('desktop')
    expect(detectFormFactor(UA.linux, { width: 800, height: 1280 })).toBe('desktop')
    expect(detectFormFactor('', { width: 412, height: 915 })).toBe('desktop')
  })
})

describe('the layout for a viewport', () => {
  it('gives a phone in a browser the studio, laid out for a hand', () => {
    // The case this all exists for: there is no app to send a phone to any more,
    // so a phone gets the rail along the bottom and a sheet for the panel.
    expect(layout(UA.androidPhone, 390, 844, true)).toEqual({
      form: 'phone',
      orientation: 'portrait',
      rail: 'bottom',
      panel: 'sheet',
      touch: true,
    })
    expect(layout(UA.iphone, 844, 390, true)).toMatchObject({
      form: 'phone',
      orientation: 'landscape',
      rail: 'bottom',
    })
  })

  it('leaves a desktop browser exactly as it is', () => {
    const desktop = layout(UA.linux, 1440, 900, false)
    expect(desktop).toEqual({
      form: 'desktop',
      orientation: 'landscape',
      rail: 'side',
      panel: 'column',
      touch: false,
    })
  })

  it('keeps the side rail on a narrow mouse-driven window', () => {
    // A window somebody chose, however narrow: the rail stays where it was and
    // the stage gets the rest.
    const narrow = layout(UA.linux, 980, 700, false)
    expect(narrow.rail).toBe('side')
    expect(narrow.form).toBe('desktop')
  })

  it('sizes for a fingertip wherever the pointer is coarse', () => {
    expect(layout(UA.linux, 1440, 900, true).touch).toBe(true)
    expect(layout(UA.ipad, 1180, 820, true).touch).toBe(true)
  })

  it('treats a held device as a held device even when the pointer says otherwise', () => {
    // A tablet with a detachable keyboard, or a webview that answers
    // `pointer: coarse` with false, is still held: it gets the bar and the
    // fingertip sizes rather than a 92px rail and a 280px column.
    expect(layout(UA.ipad, 820, 1180, false)).toMatchObject({
      form: 'tablet',
      rail: 'bottom',
      panel: 'sheet',
      touch: true,
    })
    // A mouse-driven window is not: it keeps the layout it has always had.
    expect(layout(UA.linux, 900, 700, false)).toMatchObject({
      form: 'desktop',
      rail: 'side',
      touch: false,
    })
  })

  it('puts the rail along the bottom when the side rail would cost the stage', () => {
    // Tablet, portrait: 820 is not enough for a 280px panel and a stage.
    expect(layout(UA.ipad, 820, 1180, true)).toMatchObject({
      form: 'tablet',
      orientation: 'portrait',
      rail: 'bottom',
      panel: 'sheet',
    })
    // The same tablet turned: room for both.
    expect(layout(UA.ipad, 1180, 820, true)).toMatchObject({
      orientation: 'landscape',
      rail: 'side',
      panel: 'column',
    })
    // A phone, either way up, always gets the bar.
    expect(layout(UA.androidPhone, 390, 844, true).rail).toBe('bottom')
    expect(layout(UA.androidPhone, 844, 390, true).rail).toBe('bottom')
  })

  it('answers for the awkward shapes rather than crashing on them', () => {
    const awkward: Array<[number, number]> = [
      [320, 568], // the smallest phone still in use
      [568, 320], // and the same one sideways
      [320, 320], // a square, from a split-screen nobody planned for
      [600, 960], // a foldable, half open
      [1024, 600], // a small laptop with a touchscreen
      [2560, 1080], // an ultrawide
      [720, 1440], // a phone mirrored into a portrait monitor
    ]
    for (const [width, height] of awkward) {
      const result = layout(UA.androidTablet, width, height, true)
      expect(result.orientation).toBe(height > width ? 'portrait' : 'landscape')
      expect(['side', 'bottom']).toContain(result.rail)
      // The rail and the panel are always the same decision: the panel is a
      // column exactly when the rail is beside the stage.
      expect(result.panel).toBe(result.rail === 'side' ? 'column' : 'sheet')
      expect(result.touch).toBe(true)
    }
  })

  it('switches the rail over at the width it says it does', () => {
    const at = (width: number) => layout(UA.ipad, width, 800, true)
    expect(at(SIDE_RAIL_MIN_WIDTH).rail).toBe('side')
    expect(at(SIDE_RAIL_MIN_WIDTH - 1).rail).toBe('bottom')
  })

  it('keeps a control big enough for a fingertip', () => {
    expect(MIN_TARGET).toBeGreaterThanOrEqual(40)
  })
})

describe('drawing with a stylus', () => {
  it('knows a pen from a finger', () => {
    expect(isStylus('pen')).toBe(true)
    expect(isStylus('touch')).toBe(false)
    expect(isStylus('mouse')).toBe(false)
    expect(isStylus(undefined)).toBe(false)
  })

  it('leaves a finger, a mouse and a light pen at the configured width', () => {
    expect(strokeWidth(6, 0.5)).toBe(6)
    expect(strokeWidth(6, 0)).toBe(6)
    expect(strokeWidth(6, Number.NaN)).toBe(6)
  })

  it('draws bolder when the pen is pressed', () => {
    expect(strokeWidth(6, 0.8)).toBeGreaterThan(6)
    expect(strokeWidth(6, 0.2)).toBeLessThan(6)
    // Clamped at both ends, so a pen that reports 0..1 or 0..255 cannot send the
    // stroke to zero or to a slab.
    expect(strokeWidth(6, 1)).toBeCloseTo(9.6)
    expect(strokeWidth(6, 0.01)).toBeCloseTo(3.6)
  })
})

describe('palm rejection', () => {
  it('refuses a touch that follows a stylus', () => {
    expect(isPalm({ pointerType: 'touch', lastStylusMs: 1000, now: 1000 + PALM_WINDOW_MS })).toBe(true)
    expect(isPalm({ pointerType: 'touch', lastStylusMs: 1000, now: 1000 + PALM_WINDOW_MS + 1 })).toBe(false)
  })

  it('never refuses a pen, a mouse, or a finger with no stylus around', () => {
    expect(isPalm({ pointerType: 'pen', lastStylusMs: 1000, now: 1001 })).toBe(false)
    expect(isPalm({ pointerType: 'mouse', lastStylusMs: 1000, now: 1001 })).toBe(false)
    expect(isPalm({ pointerType: 'touch', lastStylusMs: null, now: 1001 })).toBe(false)
    expect(isPalm({ pointerType: undefined, lastStylusMs: 1000, now: 1001 })).toBe(false)
  })
})
