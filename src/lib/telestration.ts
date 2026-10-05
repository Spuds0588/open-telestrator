/** Telestration model.

Every point is normalized to the video container (0.0-1.0), so a stroke keeps
its position and shape on any screen size, resolution, or orientation - and can
be serialized and replayed on remote canvases later.
*/

// The toolkit is intentionally small. Line and arrow are dropped: they are
// rarely the fastest way to mark a zone, and the highlight region covers the
// cases where a precise shape was wanted without the UI clutter.
export type Tool = 'pen' | 'highlight' | 'rect' | 'ellipse'

/** A single, ordered gesture - a stroke, a rectangle or a highlight region. */
export interface Gesture {
  tool: Tool
  color: string
  width: number
  points: Point[]
}

/** A committed, replayable stroke. */
export interface Stroke extends Gesture {
  id: string
}

export interface Point {
  /** 0.0 (left) - 1.0 (right). */
  x: number
  /** 0.0 (top) - 1.0 (bottom). */
  y: number
}

export const clamp01 = (value: number): number => Math.min(1, Math.max(0, value))

/** All tools the host can draw with. */
export const ALL_TOOLS = ['pen', 'highlight', 'rect', 'ellipse'] as const

/**
 * What each tool is called on screen. The ids are the wire names; these are the
 * words a commentator uses — a box around a player, a circle over a runner.
 */
export const TOOL_LABELS: Record<Tool, string> = {
  pen: 'Pen',
  highlight: 'Highlight',
  rect: 'Box',
  ellipse: 'Circle',
}

/** The default tool for a fresh canvas. */
export const DEFAULT_TOOL: Tool = 'pen'

/** The default colour for new strokes. */
export const DEFAULT_COLOR = '#ef4444'

/**
 * Stroke width, in the stage's 1280-wide coordinates. Fixed in the web MVP
 * (settings can expose it). Six rather than four because the strokes are
 * broadcast: a hairline drawn on the stage survives the video encoder only as a
 * blurred thread, and a telestration nobody can see is no telestration.
 */
export const DEFAULT_WIDTH = 6

/** The colour palette offered in the sidebar. */
export const COLORS = ['#ef4444', '#f59e0b', '#22c55e', '#3b82f6', '#a855f7', '#ffffff'] as const

/** What each palette colour is called on screen, so a row can say "Red". */
export const COLOR_LABELS: Record<(typeof COLORS)[number], string> = {
  '#ef4444': 'Red',
  '#f59e0b': 'Amber',
  '#22c55e': 'Green',
  '#3b82f6': 'Blue',
  '#a855f7': 'Purple',
  '#ffffff': 'White',
}

/** Draws a single gesture onto a 2D context whose transform maps 1 unit to 1
 * CSS pixel. `width`/`height` are the current CSS size of the canvas. */
export function drawStroke(
  ctx: CanvasRenderingContext2D,
  stroke: Stroke,
  width: number,
  height: number,
): void {
  const points = stroke.points
  if (points.length === 0) return

  const x = (p: Point) => p.x * width
  const y = (p: Point) => p.y * height

  ctx.strokeStyle = stroke.color
  ctx.fillStyle = stroke.color
  ctx.lineWidth = stroke.width
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'

  if (stroke.tool === 'pen') {
    if (points.length === 1) {
      ctx.beginPath()
      ctx.arc(x(points[0]), y(points[0]), stroke.width / 2, 0, Math.PI * 2)
      ctx.fill()
      return
    }
    ctx.beginPath()
    ctx.moveTo(x(points[0]), y(points[0]))
    for (let i = 1; i < points.length; i += 1) {
      ctx.lineTo(x(points[i]), y(points[i]))
    }
    ctx.stroke()
    return
  }

  const start = points[0]
  const end = points[points.length - 1]

  if (stroke.tool === 'ellipse') {
    const cx = (x(start) + x(end)) / 2
    const cy = (y(start) + y(end)) / 2
    const rx = Math.abs(x(end) - x(start)) / 2
    const ry = Math.abs(y(end) - y(start)) / 2
    ctx.beginPath()
    ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2)
    ctx.stroke()
    return
  }

  if (stroke.tool === 'rect') {
    const x0 = Math.min(x(start), x(end))
    const y0 = Math.min(y(start), y(end))
    const x1 = Math.max(x(start), x(end))
    const y1 = Math.max(y(start), y(end))
    ctx.beginPath()
    ctx.rect(x0, y0, x1 - x0, y1 - y0)
    ctx.stroke()
    return
  }

  // The remaining tool is the highlight region.
  const x0 = Math.min(x(start), x(end))
  const y0 = Math.min(y(start), y(end))
  const x1 = Math.max(x(start), x(end))
  const y1 = Math.max(y(start), y(end))
  ctx.fillStyle = stroke.color + '55'
  ctx.fillRect(x0, y0, x1 - x0, y1 - y0)
  ctx.strokeStyle = stroke.color
  ctx.lineWidth = Math.max(stroke.width, 1)
  ctx.setLineDash([4, 4])
  ctx.strokeRect(x0, y0, x1 - x0, y1 - y0)
  ctx.setLineDash([])
}

/** Redraws the committed strokes plus the in-progress draft. */
export function renderStrokes(
  ctx: CanvasRenderingContext2D,
  strokes: readonly Stroke[],
  draft: Stroke | null,
  width: number,
  height: number,
): void {
  ctx.clearRect(0, 0, width, height)
  for (const stroke of strokes) drawStroke(ctx, stroke, width, height)
  if (draft) drawStroke(ctx, draft, width, height)
}
