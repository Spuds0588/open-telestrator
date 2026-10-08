import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  COMPOSITE_HEIGHT,
  COMPOSITE_WIDTH,
  CORNER_ASPECT,
  CORNER_INSET_SHARE,
  CORNER_WIDTH_SHARE,
  NO_OVERLAYS,
  assignOverlay,
  cornerBox,
  fitInRect,
  programSourceLayers,
  pruneOverlays,
} from './composite'

/**
 * The stylesheet the stage is drawn with. Vitest runs from the project root, so
 * this is the same `src/index.css` the app is built from.
 */
const css = readFileSync('src/index.css', 'utf8')

/** The declarations of one CSS rule, keyed by property. */
function declarations(selector: string): Record<string, string> {
  const body = css.match(new RegExp(`${selector.replace(/\./g, '\\.')}\\s*\\{([^}]*)\\}`))?.[1]
  expect(body, `${selector} should exist in index.css`).toBeDefined()
  return Object.fromEntries(
    (body ?? '')
      .split(';')
      .map((line) => line.split(':').map((part) => part.trim()))
      .filter((parts) => parts.length === 2 && parts[0] !== '') as [string, string][],
  )
}

function percent(value: string | undefined, property: string): number {
  expect(value, `${property} should be set`).toBeDefined()
  return Number.parseFloat(value ?? '')
}

describe('cornerBox', () => {
  it('puts a 16:9 box in the bottom-right with the frame inset', () => {
    const box = cornerBox(COMPOSITE_WIDTH, COMPOSITE_HEIGHT, 'bottom-right')
    expect(box.width).toBeCloseTo(384)
    expect(box.height).toBeCloseTo(384 / CORNER_ASPECT)
    expect(box.x).toBeCloseTo(1280 - 384 - 32)
    expect(box.y).toBeCloseTo(720 - 216 - 18)
  })

  it('mirrors to the top-right, sharing the same x', () => {
    const top = cornerBox(1280, 720, 'top-right')
    const bottom = cornerBox(1280, 720, 'bottom-right')
    expect(top.x).toBeCloseTo(bottom.x)
    expect(top.y).toBeCloseTo(18)
    expect(bottom.y).toBeGreaterThan(top.y)
  })

  it('keeps the boxes disjoint for any sane frame size', () => {
    const top = cornerBox(1024, 576, 'top-right')
    const bottom = cornerBox(1024, 576, 'bottom-right')
    expect(top.y + top.height).toBeLessThan(bottom.y)
  })

  it('mirrors the bottom box to the left of the frame', () => {
    const right = cornerBox(COMPOSITE_WIDTH, COMPOSITE_HEIGHT, 'bottom-right')
    const left = cornerBox(COMPOSITE_WIDTH, COMPOSITE_HEIGHT, 'bottom-left')
    expect(left.x).toBeCloseTo(32)
    expect(left.y).toBeCloseTo(right.y)
    expect(left.width).toBeCloseTo(right.width)
    expect(left.height).toBeCloseTo(right.height)
  })

  it('keeps the two camera boxes apart, right of the left one', () => {
    const left = cornerBox(COMPOSITE_WIDTH, COMPOSITE_HEIGHT, 'bottom-left')
    const right = cornerBox(COMPOSITE_WIDTH, COMPOSITE_HEIGHT, 'bottom-right')
    expect(left.x + left.width).toBeLessThan(right.x)
  })
})

describe('assignOverlay', () => {
  it('fills a box and empties it again', () => {
    const filled = assignOverlay(NO_OVERLAYS, 'bottom-right', 'cam-1')
    expect(filled['bottom-right']).toBe('cam-1')
    expect(filled['bottom-left']).toBeNull()
    const emptied = assignOverlay(filled, 'bottom-right', null)
    expect(emptied['bottom-right']).toBeNull()
  })

  it('moves a source between boxes instead of showing it twice', () => {
    const one = assignOverlay(NO_OVERLAYS, 'bottom-right', 'cam-1')
    const moved = assignOverlay(one, 'bottom-left', 'cam-1')
    expect(moved['bottom-right']).toBeNull()
    expect(moved['bottom-left']).toBe('cam-1')
  })

  it('leaves the other box alone when the source is new', () => {
    const one = assignOverlay(NO_OVERLAYS, 'bottom-right', 'cam-1')
    const two = assignOverlay(one, 'bottom-left', 'cam-2')
    expect(two).toEqual({ 'bottom-right': 'cam-1', 'bottom-left': 'cam-2' })
  })

  it('returns the same object when nothing would change', () => {
    const one = assignOverlay(NO_OVERLAYS, 'bottom-right', 'cam-1')
    expect(assignOverlay(one, 'bottom-right', 'cam-1')).toBe(one)
    expect(assignOverlay(one, 'bottom-left', null)).toBe(one)
  })
})

describe('pruneOverlays', () => {
  const available = [{ id: 'cam-1' }, { id: 'cam-2' }]

  it('empties a box whose source has gone', () => {
    const one = assignOverlay(NO_OVERLAYS, 'bottom-right', 'cam-2')
    const pruned = pruneOverlays(one, [{ id: 'cam-1' }], null)
    expect(pruned['bottom-right']).toBeNull()
  })

  it('empties the box that has become the program', () => {
    const one = assignOverlay(NO_OVERLAYS, 'bottom-left', 'cam-1')
    expect(pruneOverlays(one, available, 'cam-1')['bottom-left']).toBeNull()
  })

  it('keeps boxes that are still on a live input', () => {
    const both = assignOverlay(
      assignOverlay(NO_OVERLAYS, 'bottom-right', 'cam-1'),
      'bottom-left',
      'cam-2',
    )
    // A different source is on the program, so neither box is disturbed.
    expect(pruneOverlays(both, available, 'cam-3')).toBe(both)
  })

  it('prunes one box without disturbing the other', () => {
    const both = assignOverlay(
      assignOverlay(NO_OVERLAYS, 'bottom-right', 'cam-1'),
      'bottom-left',
      'cam-2',
    )
    const pruned = pruneOverlays(both, [{ id: 'cam-1' }], null)
    expect(pruned).toEqual({ 'bottom-right': 'cam-1', 'bottom-left': null })
  })
})

describe('fitInRect', () => {
  it('letterboxes a 4:3 source inside a 16:9 box', () => {
    const box = { x: 0, y: 0, width: 1280, height: 720 }
    const fitted = fitInRect(640, 480, box)
    expect(fitted.height).toBeCloseTo(720)
    expect(fitted.width).toBeCloseTo(960)
    expect(fitted.x).toBeCloseTo(160)
    expect(fitted.y).toBeCloseTo(0)
  })

  it('pillarboxes a portrait source into a wide box', () => {
    const box = cornerBox(1280, 720, 'bottom-right')
    const fitted = fitInRect(1080, 1920, box)
    expect(fitted.height).toBeCloseTo(box.height)
    expect(fitted.width).toBeLessThan(box.width)
    expect(fitted.x).toBeGreaterThan(box.x)
  })

  it('fills a matching aspect exactly', () => {
    const fitted = fitInRect(1920, 1080, { x: 100, y: 50, width: 640, height: 360 })
    expect(fitted).toEqual({ x: 100, y: 50, width: 640, height: 360 })
  })

  it('leaves the box alone for a source with no size yet', () => {
    const box = { x: 1, y: 2, width: 3, height: 4 }
    expect(fitInRect(0, 0, box)).toEqual(box)
  })
})

/** A stand-in for a video element that has produced a frame. */
const frame = (videoWidth = 1920, videoHeight = 1080, readyState = 4) => ({
  readyState,
  videoWidth,
  videoHeight,
})

/**
 * The compositor's own picture. It cannot be seen from the DOM — the canvas is
 * never in the document and only runs for viewers or stream-out — so the layer
 * order and which boxes get pixels are pinned here instead.
 */
describe('programSourceLayers', () => {
  const frameSize = { frameWidth: COMPOSITE_WIDTH, frameHeight: COMPOSITE_HEIGHT }
  const program = frame()

  it('draws the program alone, filling the frame, when nothing else is on', () => {
    const layers = programSourceLayers({
      program,
      live: null,
      replaying: false,
      corners: [null, null],
      ...frameSize,
    })
    expect(layers).toHaveLength(1)
    expect(layers[0].rect).toEqual({ x: 0, y: 0, width: COMPOSITE_WIDTH, height: COMPOSITE_HEIGHT })
  })

  it('shows the live feed in the top-right only while a replay plays', () => {
    const live = frame(1280, 720)
    const options = { program, live, replaying: true, corners: [null, null], ...frameSize }
    const [programLayer, liveLayer] = programSourceLayers(options)
    expect(liveLayer.rect).toEqual(cornerBox(COMPOSITE_WIDTH, COMPOSITE_HEIGHT, 'top-right'))
    expect(programLayer.video).toBe(program)

    expect(programSourceLayers({ ...options, replaying: false })).toHaveLength(1)
  })

  it('carries both cameras at once, the right-hand box drawn first', () => {
    const camera = frame()
    const phone = frame(720, 1280)
    const layers = programSourceLayers({
      program,
      live: null,
      replaying: false,
      corners: [camera, phone],
      ...frameSize,
    })
    expect(layers).toHaveLength(3)
    expect(layers[1].video).toBe(camera)
    expect(layers[2].video).toBe(phone)
    expect(layers[1].rect).toEqual(cornerBox(COMPOSITE_WIDTH, COMPOSITE_HEIGHT, 'bottom-right'))
    // The portrait phone is pillarboxed inside the left box, still inside it.
    const left = cornerBox(COMPOSITE_WIDTH, COMPOSITE_HEIGHT, 'bottom-left')
    expect(layers[2].rect.x).toBeGreaterThanOrEqual(left.x)
    expect(layers[2].rect.x + layers[2].rect.width).toBeLessThanOrEqual(left.x + left.width)
    expect(layers[2].rect.height).toBeCloseTo(left.height)
  })

  it('leaves an empty box out and keeps the other', () => {
    const camera = frame()
    const layers = programSourceLayers({
      program,
      live: null,
      replaying: false,
      corners: [null, camera],
      ...frameSize,
    })
    expect(layers.map((layer) => layer.video)).toEqual([program, camera])
  })

  it('skips a source that has not produced a frame yet', () => {
    const layers = programSourceLayers({
      program,
      live: frame(1280, 720, 1),
      replaying: true,
      corners: [frame(0, 0), frame(1920, 1080)],
      ...frameSize,
    })
    expect(layers.map((layer) => layer.video.videoWidth)).toEqual([1920, 1920])
  })

  it('draws nothing before the program has a frame', () => {
    expect(
      programSourceLayers({
        program: null,
        live: null,
        replaying: false,
        corners: [null, null],
        ...frameSize,
      }),
    ).toEqual([])
  })

  it('never lets a corner box cover the program or the other box', () => {
    const camera = frame()
    const phone = frame()
    const layers = programSourceLayers({
      program,
      live: frame(1280, 720),
      replaying: true,
      corners: [camera, phone],
      ...frameSize,
    })
    const [programLayer, liveLayer, rightLayer, leftLayer] = layers
    expect(liveLayer.rect.y).toBeLessThan(programLayer.rect.height)
    expect(leftLayer.rect.x + leftLayer.rect.width).toBeLessThan(rightLayer.rect.x)
  })
})

/**
 * The stage and the canvas draw the same boxes twice, so the CSS has to carry
 * the constants above it. This is the check that keeps them in step: the DOM
 * rules are read from index.css and compared with the geometry the compositor
 * draws, which the project notes call out as a thing to get wrong.
 */
describe('the DOM corner boxes', () => {
  const inset = CORNER_INSET_SHARE * 100

  it('gives every overlay the same width and 16:9 shape the compositor uses', () => {
    const rule = declarations('.screen__corner')
    expect(percent(rule.width, 'width')).toBeCloseTo(CORNER_WIDTH_SHARE * 100)
    const [wide, tall] = (rule['aspect-ratio'] ?? '').split('/').map((n) => Number(n.trim()))
    expect(wide / tall).toBeCloseTo(CORNER_ASPECT)
  })

  it('anchors the right-hand camera box to the bottom-right, inset', () => {
    const rule = declarations('.screen__corner--bottom-right')
    expect(percent(rule.bottom, 'bottom')).toBeCloseTo(inset)
    expect(percent(rule.right, 'right')).toBeCloseTo(inset)
    expect(rule.left).toBeUndefined()
  })

  it('mirrors the left-hand camera box, inset with no anchor on the right', () => {
    const rule = declarations('.screen__corner--bottom-left')
    expect(percent(rule.bottom, 'bottom')).toBeCloseTo(inset)
    expect(percent(rule.left, 'left')).toBeCloseTo(inset)
    expect(rule.right).toBeUndefined()
  })

  it('keeps the live corner in the top-right', () => {
    const rule = declarations('.screen__corner--live')
    expect(percent(rule.top, 'top')).toBeCloseTo(inset)
    expect(percent(rule.right, 'right')).toBeCloseTo(inset)
  })
})
