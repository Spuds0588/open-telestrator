import { describe, expect, it } from 'vitest'
import {
  COMPOSITE_HEIGHT,
  COMPOSITE_WIDTH,
  CORNER_ASPECT,
  cornerBox,
  fitInRect,
} from './composite'

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
