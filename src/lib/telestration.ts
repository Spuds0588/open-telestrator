/**
 * Telestration model.
 *
 * Every point is normalized to the video container (0.0–1.0), so a stroke keeps
 * its position and shape on any screen size, resolution, or orientation — and
 * can be serialized and replayed on remote canvases later.
 */

export type Tool = 'pen' | 'line' | 'arrow' | 'ellipse'

export interface Point {
  /** 0.0 (left) – 1.0 (right). */
  x: number
  /** 0.0 (top) – 1.0 (bottom). */
  y: number
}

export interface Stroke {
  tool: Tool
  color: string
  /** Stroke width in CSS pixels at the canvas's current display size. */
  width: number
  points: Point[]
}

export const clamp01 = (value: number): number => Math.min(1, Math.max(0, value))

/**
 * Draws a single stroke onto a 2D context whose transform maps 1 unit to 1 CSS
 * pixel. `width`/`height` are the current CSS size of the canvas.
 */
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

  // line | arrow
  ctx.beginPath()
  ctx.moveTo(x(start), y(start))
  ctx.lineTo(x(end), y(end))
  ctx.stroke()

  if (stroke.tool === 'arrow') {
    const angle = Math.atan2(y(end) - y(start), x(end) - x(start))
    const head = Math.max(stroke.width * 3, 12)
    ctx.beginPath()
    ctx.moveTo(x(end), y(end))
    ctx.lineTo(
      x(end) - head * Math.cos(angle - Math.PI / 6),
      y(end) - head * Math.sin(angle - Math.PI / 6),
    )
    ctx.moveTo(x(end), y(end))
    ctx.lineTo(
      x(end) - head * Math.cos(angle + Math.PI / 6),
      y(end) - head * Math.sin(angle + Math.PI / 6),
    )
    ctx.stroke()
  }
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
