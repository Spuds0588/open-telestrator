/**
 * Shared-drawing protocol (host ⇄ co-host).
 *
 * A co-host joins through the camera magic link and, once its data channel is
 * up, the host and the co-host exchange drawing operations over it. Strokes are
 * already normalized to the frame (0.0–1.0), so they land in the same place on
 * either screen; the messages here are just the JSON payloads.
 *
 * The host is the single writer of the program's stroke stack: it applies every
 * operation to its own list — the one the compositor puts on air — and forwards
 * each operation to the other co-hosts. A co-host never forwards what it
 * receives, so an operation can travel at most one hop and cannot loop.
 *
 * Everything a peer can send is untrusted, so payloads are validated and
 * clamped here rather than at the call site. The validators are pure and the
 * reducer is pure, which keeps the whole protocol unit-testable.
 */

import { ALL_TOOLS, clamp01, type Point, type Stroke, type Tool } from './telestration'

/** Most points honoured in one stroke; a runaway gesture is trimmed, not drawn. */
export const MAX_POINTS = 4000

/** Most strokes kept in the shared stack; older ones fall off the top. */
export const MAX_STROKES = 500

/** Accepted stroke widths, in stage coordinates. */
export const MIN_WIDTH = 1
export const MAX_WIDTH = 64

const TOOL_SET: ReadonlySet<string> = new Set(ALL_TOOLS)
const HEX_COLOR = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/
const MAX_ID = 64

/**
 * A drawing operation.
 *
 * - `draw`   add one committed stroke.
 * - `remove` take one stroke back out, by id (how undo travels).
 * - `clear`  empty the whole stack.
 * - `sync`   replace the stack outright — sent by the host to a new co-host so
 *            it starts from the picture that is already on air. Never accepted
 *            from a co-host.
 */
export type CollabOp =
  | { t: 'draw'; stroke: Stroke }
  | { t: 'remove'; id: string }
  | { t: 'clear' }
  | { t: 'sync'; strokes: Stroke[] }

/** Validate and normalize one untrusted stroke, or null when it is malformed. */
export function normalizeStroke(value: unknown): Stroke | null {
  if (typeof value !== 'object' || value === null) return null
  const raw = value as Record<string, unknown>

  const id = raw.id
  if (typeof id !== 'string' || id.length === 0 || id.length > MAX_ID) return null

  const tool = raw.tool
  if (typeof tool !== 'string' || !TOOL_SET.has(tool)) return null

  const color = raw.color
  if (typeof color !== 'string' || !HEX_COLOR.test(color)) return null

  const width = raw.width
  if (typeof width !== 'number' || !Number.isFinite(width)) return null

  const points = raw.points
  if (!Array.isArray(points) || points.length === 0) return null

  const normalizedPoints: Point[] = []
  for (const entry of points.slice(0, MAX_POINTS)) {
    if (typeof entry !== 'object' || entry === null) return null
    const point = entry as Record<string, unknown>
    const x = point.x
    const y = point.y
    if (typeof x !== 'number' || !Number.isFinite(x)) return null
    if (typeof y !== 'number' || !Number.isFinite(y)) return null
    normalizedPoints.push({ x: clamp01(x), y: clamp01(y) })
  }

  return {
    id,
    tool: tool as Tool,
    color,
    width: Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, width)),
    points: normalizedPoints,
  }
}

/** Validate a list of strokes, dropping malformed or duplicate ids. */
export function normalizeStrokes(value: unknown, cap: number = MAX_STROKES): Stroke[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  const out: Stroke[] = []
  for (const entry of value) {
    const stroke = normalizeStroke(entry)
    if (!stroke || seen.has(stroke.id)) continue
    seen.add(stroke.id)
    out.push(stroke)
    if (out.length >= cap) break
  }
  return out
}

/** Validate an untrusted data-channel payload into a known operation. */
export function parseCollabOp(raw: unknown): CollabOp | null {
  if (typeof raw !== 'object' || raw === null) return null
  const message = raw as Record<string, unknown>
  switch (message.t) {
    case 'draw': {
      const stroke = normalizeStroke(message.stroke)
      return stroke ? { t: 'draw', stroke } : null
    }
    case 'remove': {
      const id = message.id
      return typeof id === 'string' && id.length > 0 && id.length <= MAX_ID
        ? { t: 'remove', id }
        : null
    }
    case 'clear':
      return { t: 'clear' }
    case 'sync':
      return { t: 'sync', strokes: normalizeStrokes(message.strokes) }
    default:
      return null
  }
}

/**
 * Apply an operation to a stroke stack, returning a new array.
 *
 * Idempotent per stroke: applying the same `draw` twice keeps one copy, and a
 * `remove` for an id nobody has is a no-op. That is what lets the host forward
 * an operation to every co-host — including the one that sent it — without any
 * of them drawing it twice.
 */
export function applyCollabOp(strokes: readonly Stroke[], op: CollabOp): Stroke[] {
  switch (op.t) {
    case 'draw': {
      if (strokes.some((stroke) => stroke.id === op.stroke.id)) return strokes as Stroke[]
      const next = [...strokes, op.stroke]
      return next.length > MAX_STROKES ? next.slice(next.length - MAX_STROKES) : next
    }
    case 'remove':
      return strokes.filter((stroke) => stroke.id !== op.id)
    case 'clear':
      return []
    case 'sync':
      return op.strokes
  }
}

/** Wrap a committed stroke as a `draw` operation. */
export function drawOp(stroke: Stroke): CollabOp {
  return { t: 'draw', stroke }
}

/** Wrap a whole stack as a `sync` operation. */
export function syncOp(strokes: readonly Stroke[]): CollabOp {
  return { t: 'sync', strokes: [...strokes] }
}
