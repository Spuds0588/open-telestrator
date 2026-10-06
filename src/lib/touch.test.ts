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
  type ShellMode,
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

const layout = (mode: ShellMode, userAgent: string, width: number, height: number, touch: boolean) =>
  layoutFor({ mode, userAgent, width, height, touch })

describe('which shape of device this is', () => {
  it('reads the user agent the way the devices write it', () => {
    expect(detectFormFactor('desktop', UA.androidPhone, { width: 412, height: 915 })).toBe('phone')
    expect(detectFormFactor('mobile', UA.androidTablet, { width: 1280, height: 800 })).toBe('tablet')
    expect(detectFormFactor('mobile', UA.ipad, { width: 820, height: 1180 })).toBe('tablet')
    expect(detectFormFactor('mobile', UA.iphone, { width: 390, height: 844 })).toBe('phone')
    expect(detectFormFactor('desktop', UA.linux, { width: 1440, height: 900 })).toBe('desktop')
  })

  it('falls back to the short side when the user agent says nothing', () => {
    // A phone shell whose webview reports a desktop user agent, and a Windows
    // tablet in the desktop shell, both land here.
    expect(detectFormFactor('mobile', UA.linux, { width: 412, height: 915 })).toBe('phone')
    expect(detectFormFactor('mobile', UA.linux, { width: 800, height: 1280 })).toBe('tablet')
    expect(detectFormFactor('desktop', UA.linux, { width: 412, height: 915 })).toBe('desktop')
  })
})

describe('the layout for a viewport', () => {
  it('applies nothing in a browser, phone or not', () => {
    // The web build is still desktop-only: a phone gets the notice, not this.
    expect(layout('browser', UA.androidPhone, 390, 844, true)).toBeNull()
    expect(layout('browser', UA.linux, 1920, 1080, false)).toBeNull()
  })

  it('leaves the desktop shell exactly as it is', () => {
    const desktop = layout('desktop', UA.linux, 1440, 900, false)
    expect(desktop).toEqual({
      form: 'desktop',
      orientation: 'landscape',
      rail: 'side',
      panel: 'column',
      touch: false,
    })
  })

  it('keeps the side rail on a narrow mouse-driven window', () => {
    // The shell's own minimum is 960 wide; a mouse keeps the rail it knows.
    const narrow = layout('desktop', UA.linux, 980, 700, false)
    expect(narrow?.rail).toBe('side')
    expect(narrow?.form).toBe('desktop')
  })

  it('sizes for a fingertip anywhere a touch device is running', () => {
    expect(layout('desktop', UA.linux, 1440, 900, true)?.touch).toBe(true)
    expect(layout('mobile', UA.ipad, 1180, 820, true)?.touch).toBe(true)
  })

  it('treats a held device as a held device even when the pointer says otherwise', () => {
    // A tablet with a detachable keyboard, or a webview that answers
    // `pointer: coarse` with false, is still held: it gets the bar and the
    // fingertip sizes rather than a 92px rail and a 280px column.
    expect(layout('mobile', UA.ipad, 820, 1180, false)).toMatchObject({
      form: 'tablet',
      rail: 'bottom',
      panel: 'sheet',
      touch: true,
    })
    // A mouse-driven window is not: it keeps the layout it has always had.
    expect(layout('desktop', UA.linux, 900, 700, false)).toMatchObject({
      form: 'desktop',
      rail: 'side',
      touch: false,
    })
  })

  it('puts the rail along the bottom when the side rail would cost the stage', () => {
    // Tablet, portrait: 820 is not enough for a 280px panel and a stage.
    expect(layout('mobile', UA.ipad, 820, 1180, true)).toMatchObject({
      form: 'tablet',
      orientation: 'portrait',
      rail: 'bottom',
      panel: 'sheet',
    })
    // The same tablet turned: room for both.
    expect(layout('mobile', UA.ipad, 1180, 820, true)).toMatchObject({
      orientation: 'landscape',
      rail: 'side',
      panel: 'column',
    })
    // A phone, either way up, always gets the bar.
    expect(layout('mobile', UA.androidPhone, 390, 844, true)?.rail).toBe('bottom')
    expect(layout('mobile', UA.androidPhone, 844, 390, true)?.rail).toBe('bottom')
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
      const result = layout('mobile', UA.androidTablet, width, height, true)
      expect(result).not.toBeNull()
      expect(result?.orientation).toBe(height > width ? 'portrait' : 'landscape')
      expect(['side', 'bottom']).toContain(result?.rail)
      // The rail and the panel are always the same decision: the panel is a
      // column exactly when the rail is beside the stage.
      expect(result?.panel).toBe(result?.rail === 'side' ? 'column' : 'sheet')
      expect(result?.touch).toBe(true)
    }
  })

  it('switches the rail over at the width it says it does', () => {
    const at = (width: number) => layout('mobile', UA.ipad, width, 800, true)
    expect(at(SIDE_RAIL_MIN_WIDTH)?.rail).toBe('side')
    expect(at(SIDE_RAIL_MIN_WIDTH - 1)?.rail).toBe('bottom')
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
