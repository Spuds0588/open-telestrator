import { describe, expect, it } from 'vitest'
import {
  MAX_STROKES,
  MAX_WIDTH,
  applyCollabOp,
  drawOp,
  normalizeStroke,
  normalizeStrokes,
  parseCollabOp,
  syncOp,
  type CollabOp,
} from './collab'
import type { Stroke } from './telestration'

function stroke(overrides: Partial<Stroke> = {}): Stroke {
  return {
    id: 's1',
    tool: 'pen',
    color: '#ef4444',
    width: 6,
    points: [
      { x: 0.1, y: 0.2 },
      { x: 0.3, y: 0.4 },
    ],
    ...overrides,
  }
}

describe('normalizeStroke', () => {
  it('accepts a well-formed stroke', () => {
    expect(normalizeStroke(stroke())).toEqual(stroke())
  })

  it('clamps points into the frame and width into range', () => {
    const normalized = normalizeStroke(
      stroke({ width: 999, points: [{ x: -1, y: 2 }, { x: 0.5, y: 0.5 }] }),
    )
    expect(normalized?.width).toBe(MAX_WIDTH)
    expect(normalized?.points).toEqual([{ x: 0, y: 1 }, { x: 0.5, y: 0.5 }])
  })

  it('rejects unknown tools, bad colours, empty ids and no points', () => {
    expect(normalizeStroke(stroke({ tool: 'laser' as never }))).toBeNull()
    expect(normalizeStroke(stroke({ color: 'red' }))).toBeNull()
    expect(normalizeStroke(stroke({ color: '#ef4444;background:url(x)' }))).toBeNull()
    expect(normalizeStroke(stroke({ id: '' }))).toBeNull()
    expect(normalizeStroke(stroke({ id: 'x'.repeat(65) }))).toBeNull()
    expect(normalizeStroke(stroke({ points: [] }))).toBeNull()
  })

  it('rejects non-finite coordinates rather than drawing a NaN', () => {
    expect(normalizeStroke(stroke({ points: [{ x: Number.NaN, y: 0 }] }))).toBeNull()
    expect(normalizeStroke(stroke({ points: [{ x: 0, y: Number.POSITIVE_INFINITY }] }))).toBeNull()
  })

  it('rejects anything that is not a stroke object', () => {
    expect(normalizeStroke(null)).toBeNull()
    expect(normalizeStroke('draw')).toBeNull()
    expect(normalizeStroke({ points: [{ x: 0, y: 0 }] })).toBeNull()
  })
})

describe('normalizeStrokes', () => {
  it('drops malformed entries and duplicate ids, keeping order', () => {
    const list = normalizeStrokes([stroke(), { nope: true }, stroke({ id: 's2' }), stroke()])
    expect(list.map((entry) => entry.id)).toEqual(['s1', 's2'])
  })

  it('returns an empty list for a non-array', () => {
    expect(normalizeStrokes('nope')).toEqual([])
  })
})

describe('parseCollabOp', () => {
  it('reads each operation', () => {
    expect(parseCollabOp({ t: 'draw', stroke: stroke() })).toEqual({ t: 'draw', stroke: stroke() })
    expect(parseCollabOp({ t: 'remove', id: 's1' })).toEqual({ t: 'remove', id: 's1' })
    expect(parseCollabOp({ t: 'clear' })).toEqual({ t: 'clear' })
    expect(parseCollabOp({ t: 'sync', strokes: [stroke()] })).toEqual({
      t: 'sync',
      strokes: [stroke()],
    })
  })

  it('rejects unknown operations and malformed payloads', () => {
    expect(parseCollabOp({ t: 'explode' })).toBeNull()
    expect(parseCollabOp({ t: 'draw', stroke: { id: 'x' } })).toBeNull()
    expect(parseCollabOp({ t: 'remove' })).toBeNull()
    expect(parseCollabOp(null)).toBeNull()
    expect(parseCollabOp('draw')).toBeNull()
  })

  it('still reads a sync with a bad entry by dropping it', () => {
    expect(parseCollabOp({ t: 'sync', strokes: [stroke(), 42] })).toEqual({
      t: 'sync',
      strokes: [stroke()],
    })
  })
})

describe('applyCollabOp', () => {
  it('appends a drawn stroke', () => {
    expect(applyCollabOp([], drawOp(stroke())).map((entry) => entry.id)).toEqual(['s1'])
  })

  it('is idempotent: a repeated draw does not duplicate the stroke', () => {
    const once = applyCollabOp([], drawOp(stroke()))
    const twice = applyCollabOp(once, drawOp(stroke()))
    expect(twice).toHaveLength(1)
    // The same reference comes back, so React does not even re-render.
    expect(twice).toBe(once)
  })

  it('removes by id and clears outright', () => {
    const drawn = [stroke({ id: 'a' }), stroke({ id: 'b' })]
    expect(applyCollabOp(drawn, { t: 'remove', id: 'a' }).map((entry) => entry.id)).toEqual(['b'])
    expect(applyCollabOp(drawn, { t: 'remove', id: 'ghost' })).toHaveLength(2)
    expect(applyCollabOp(drawn, { t: 'clear' })).toEqual([])
  })

  it('replaces the stack on sync', () => {
    const synced: CollabOp = syncOp([stroke({ id: 'z' })])
    expect(applyCollabOp([stroke({ id: 'a' })], synced).map((entry) => entry.id)).toEqual(['z'])
  })

  it('keeps the stack bounded, dropping the oldest strokes', () => {
    let stack: Stroke[] = []
    for (let i = 0; i < MAX_STROKES + 5; i += 1) {
      stack = applyCollabOp(stack, drawOp(stroke({ id: `s${i}` })))
    }
    expect(stack).toHaveLength(MAX_STROKES)
    expect(stack[0].id).toBe('s5')
  })
})

describe('host and co-host converge', () => {
  /**
   * Models the real flow: the host applies its own op and sends it to every
   * co-host; a co-host applies its own op and sends it up, and the host applies
   * it and forwards it to the others (the sender already has it).
   */
  function makeSession(hostStart: Stroke[] = []) {
    let host = hostStart
    let cohost: Stroke[] = []
    let synced = false
    const hostLocal = (op: CollabOp) => {
      host = applyCollabOp(host, op)
      cohost = applyCollabOp(cohost, op)
    }
    const cohostLocal = (op: CollabOp) => {
      cohost = applyCollabOp(cohost, op)
      host = applyCollabOp(host, op)
    }
    /** The host sends the current stack when a co-host joins. */
    const join = () => {
      cohost = applyCollabOp(cohost, syncOp(host))
      synced = true
    }
    return { hostLocal, cohostLocal, join, get host() { return host }, get cohost() { return cohost }, get synced() { return synced } }
  }

  it('starts a new co-host from the strokes already on air', () => {
    const session = makeSession([stroke({ id: 'on-air' })])
    session.join()
    expect(session.cohost.map((entry) => entry.id)).toEqual(['on-air'])
  })

  it('agrees after interleaved draws, undo and clear from both ends', () => {
    const session = makeSession()
    session.join()
    session.hostLocal(drawOp(stroke({ id: 'a' })))
    session.cohostLocal(drawOp(stroke({ id: 'b' })))
    session.hostLocal(drawOp(stroke({ id: 'c' })))
    session.cohostLocal({ t: 'remove', id: 'a' })
    expect(session.cohost).toEqual(session.host)
    expect(session.host.map((entry) => entry.id)).toEqual(['b', 'c'])
    session.hostLocal({ t: 'clear' })
    expect(session.cohost).toEqual(session.host)
    expect(session.host).toEqual([])
  })
})
