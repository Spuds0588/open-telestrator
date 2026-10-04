import { useCallback, useEffect, useRef } from 'react'
import { clamp01, renderStrokes, type Gesture, type Point, type Tool, type Stroke } from '../lib/telestration'

/**
 * The telestration canvas laid over the video.
 *
 * This component is *controlled*: the committed strokes and the drawing state
 * (`tool`/`color`/`width`) live in the parent (the App) and are threaded down
 * here as read-only props. The canvas paints them imperatively (its refs are
 * the canvas DOM + the transient draft). No React state is used while drawing.
 *
 * When a gesture ends, `onStrokeCommitted` is called, so the parent can append
 * the gesture to its own committed-stroke list, run undo/redo history, and let
 * the canvas re-paint with the updated list.
 */
export function TelestrationOverlay({
  strokes,
  tool,
  color,
  width,
  onStrokeCommitted,
}: {
  /** Committed, replayable strokes, owned by the host (App). */
  strokes: Stroke[]
  /** The active drawing tool (for the canvas active class). */
  tool: Tool
  /** The active colour (used while a gesture is in progress). */
  color: string
  /** The active stroke width (used while a gesture is in progress). */
  width: number
  /** Called once per completed gesture with the gesture to commit. */
  onStrokeCommitted: (gesture: Gesture & { id: string }) => void
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  // The in-progress gesture (not yet committed). Lives in a ref so it survives
  // React re-renders while the pointer is down.
  const draftRef = useRef<Gesture & { id: string } | null>(null)
  const activePointerRef = useRef<number | null>(null)

  const nextId = useCallback(() => crypto.randomUUID(), [])

  const render = useCallback(() => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return

    const cssWidth = canvas.clientWidth
    const cssHeight = canvas.clientHeight
    const dpr = window.devicePixelRatio || 1
    const pixelWidth = Math.round(cssWidth * dpr)
    const pixelHeight = Math.round(cssHeight * dpr)
    if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
      canvas.width = pixelWidth
      canvas.height = pixelHeight
    }

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    renderStrokes(ctx, strokes, draftRef.current, cssWidth, cssHeight)
  }, [strokes, renderStrokes])

  // Paint committed strokes + the in-progress draft on mount and whenever the
  // list of committed strokes changes.
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const observer = new ResizeObserver(() => render())
    observer.observe(canvas)
    render()
    return () => observer.disconnect()
  }, [render])

  const toPoint = useCallback((event: React.PointerEvent<HTMLCanvasElement>): Point => {
    const rect = event.currentTarget.getBoundingClientRect()
    return {
      x: clamp01((event.clientX - rect.left) / rect.width),
      y: clamp01((event.clientY - rect.top) / rect.height),
    }
  }, [])

  const handlePointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (activePointerRef.current !== null) return
    activePointerRef.current = event.pointerId
    try {
      // Keeps receiving move events if the pointer leaves the canvas mid-stroke.
      event.currentTarget.setPointerCapture(event.pointerId)
    } catch {
      // Some environments (and synthetic/test pointers) reject capture; drawing
      // still works via the element's own event listeners.
    }
    draftRef.current = { id: nextId(), tool, color, width, points: [toPoint(event)] }
    render()
  }

  const handlePointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const draft = draftRef.current
    if (activePointerRef.current !== event.pointerId || !draft) return
    const point = toPoint(event)
    if (draft.tool === 'pen') {
      draft.points.push(point)
    } else {
      draft.points[1] = point
    }
    render()
  }

  const handlePointerEnd = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (activePointerRef.current !== event.pointerId) return
    activePointerRef.current = null
    const draft = draftRef.current
    draftRef.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    if (draft && draft.points.length > 0) {
      onStrokeCommitted?.(draft)
    }
  }

  return (
    <div className="overlay">
      <canvas
        ref={canvasRef}
        className={`overlay__canvas ${tool === 'pen' ? 'overlay__canvas--active' : ''}`}
        data-testid="telestration-canvas"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerEnd}
        onPointerCancel={handlePointerEnd}
      />
    </div>
  )
}
