import { describe, expect, it } from 'vitest'
import {
  clamp01,
  drawStroke,
  renderStrokes,
  toolGlyph,
  type Point,
  type Stroke,
  type Tool,
} from './telestration'

interface FakeContext {
  calls: string[]
  ctx: CanvasRenderingContext2D
}

function fakeContext(): FakeContext {
  const calls: string[] = []
  const ctx = {
    strokeStyle: '',
    fillStyle: '',
    lineWidth: 0,
    lineCap: '',
    lineJoin: '',
    setLineDash: (dash: number[]) => calls.push(`dash:${dash.join('|')}`),
    beginPath: () => calls.push('begin'),
    moveTo: (x: number, y: number) => calls.push(`move:${x},${y}`),
    lineTo: (x: number, y: number) => calls.push(`line:${x},${y}`),
    arc: (x: number, y: number, radius: number) => calls.push(`arc:${x},${y},${radius}`),
    ellipse: (x: number, y: number, rx: number, ry: number) =>
      calls.push(`ellipse:${x},${y},${rx},${ry}`),
    rect: (x: number, y: number, w: number, h: number) => calls.push(`rect:${x},${y},${w},${h}`),
    fillRect: (x: number, y: number, w: number, h: number) =>
      calls.push(`fillRect:${x},${y},${w},${h}`),
    strokeRect: (x: number, y: number, w: number, h: number) =>
      calls.push(`strokeRect:${x},${y},${w},${h}`),
    stroke: () => calls.push('stroke'),
    fill: () => calls.push('fill'),
    clearRect: () => calls.push('clear'),
  }
  return { calls, ctx: ctx as unknown as CanvasRenderingContext2D }
}

function makeStroke(tool: Tool, points: Point[], color = '#ef4444', width = 4): Stroke {
  return { id: `${tool}-stroke`, tool, color, width, points }
}

describe('clamp01', () => {
  it('keeps values inside the normalized range', () => {
    expect(clamp01(-0.5)).toBe(0)
    expect(clamp01(0.25)).toBe(0.25)
    expect(clamp01(1.5)).toBe(1)
  })
})

describe('toolGlyph', () => {
  it('returns a distinct glyph for every tool', () => {
    const glyphs = (['pen', 'highlight', 'rect', 'ellipse'] as Tool[]).map(toolGlyph)
    expect(glyphs.every((glyph) => glyph.length > 0)).toBe(true)
    expect(new Set(glyphs).size).toBe(4)
  })
})

describe('drawStroke', () => {
  it('ignores an empty gesture', () => {
    const { calls, ctx } = fakeContext()
    drawStroke(ctx, makeStroke('pen', []), 200, 100)
    expect(calls).toEqual([])
  })

  it('paints a freehand line through every point (scaled to pixels)', () => {
    const { calls, ctx } = fakeContext()
    drawStroke(
      ctx,
      makeStroke('pen', [
        { x: 0, y: 0 },
        { x: 0.5, y: 0.5 },
        { x: 1, y: 1 },
      ]),
      200,
      100,
    )
    expect(calls).toEqual([
      'begin',
      'move:0,0',
      'line:100,50',
      'line:200,100',
      'stroke',
    ])
  })

  it('paints a single-point pen gesture as a dot', () => {
    const { calls, ctx } = fakeContext()
    drawStroke(ctx, makeStroke('pen', [{ x: 0.5, y: 0.5 }], '#fff', 8), 200, 100)
    expect(calls).toEqual(['begin', 'arc:100,50,4', 'fill'])
  })

  it('draws a rectangle with normalized corners scaled to pixels', () => {
    const { calls, ctx } = fakeContext()
    drawStroke(ctx, makeStroke('rect', [{ x: 0.75, y: 0.5 }, { x: 0.25, y: 0 }]), 200, 100)
    expect(calls).toEqual(['begin', 'rect:50,0,100,50', 'stroke'])
  })

  it('draws an ellipse inscribed in the dragged bounds', () => {
    const { calls, ctx } = fakeContext()
    drawStroke(ctx, makeStroke('ellipse', [{ x: 0.25, y: 0.5 }, { x: 0.5, y: 1 }]), 200, 100)
    expect(calls).toEqual(['begin', 'ellipse:75,75,25,25', 'stroke'])
  })

  it('fills and dashes the highlight region, then resets the dash', () => {
    const { calls, ctx } = fakeContext()
    drawStroke(ctx, makeStroke('highlight', [{ x: 0, y: 0 }, { x: 0.5, y: 0.5 }], '#22c55e', 2), 200, 100)
    expect(calls).toEqual([
      'fillRect:0,0,100,50',
      'dash:4|4',
      'strokeRect:0,0,100,50',
      'dash:',
    ])
    expect(ctx.fillStyle).toBe('#22c55e55')
  })
})

describe('renderStrokes', () => {
  it('clears, then paints committed strokes and the in-progress draft', () => {
    const { calls, ctx } = fakeContext()
    renderStrokes(
      ctx,
      [makeStroke('rect', [{ x: 0, y: 0 }, { x: 0.5, y: 0.5 }])],
      makeStroke('pen', [{ x: 0.1, y: 0.1 }, { x: 0.2, y: 0.2 }]),
      200,
      100,
    )
    expect(calls[0]).toBe('clear')
    expect(calls.slice(1, 4)).toEqual(['begin', 'rect:0,0,100,50', 'stroke'])
    expect(calls).toContain('move:20,10')
    expect(calls).toContain('line:40,20')
  })
})
