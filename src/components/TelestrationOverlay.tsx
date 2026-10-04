import { useCallback, useEffect, useRef, useState } from 'react'
import { clamp01, renderStrokes, type Point, type Stroke, type Tool } from '../lib/telestration'
import { COLORS, Toolbar, type Mode } from './Toolbar'

/**
 * The telestration canvas laid over the video.
 *
 * The canvas never re-renders React state while drawing: strokes live in refs and
 * are painted imperatively, so a long freehand stroke costs no re-renders. React
 * state is only used for the toolbar (`revision` bumps after undo/clear).
 */
export function TelestrationOverlay() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const strokesRef = useRef<Stroke[]>([])
  const draftRef = useRef<Stroke | null>(null)
  const activePointerRef = useRef<number | null>(null)

  const [revision, setRevision] = useState(0)
  const [mode, setMode] = useState<Mode>('draw')
  const [tool, setTool] = useState<Tool>('pen')
  const [color, setColor] = useState<string>(COLORS[0])
  const [width, setWidth] = useState(4)

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
    renderStrokes(ctx, strokesRef.current, draftRef.current, cssWidth, cssHeight)
  }, [])

  // Repaint on mount, on resize (window/orientation/layout), and when a stroke
  // is committed or removed.
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const observer = new ResizeObserver(() => render())
    observer.observe(canvas)
    render()
    return () => observer.disconnect()
  }, [render])

  useEffect(() => {
    render()
  }, [revision, render])

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
    draftRef.current = { tool, color, width, points: [toPoint(event)] }
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
      strokesRef.current.push(draft)
    }
    setRevision((value) => value + 1)
  }

  const undo = () => {
    strokesRef.current.pop()
    setRevision((value) => value + 1)
  }

  const clear = () => {
    strokesRef.current = []
    draftRef.current = null
    setRevision((value) => value + 1)
  }

  return (
    <div className="overlay">
      <canvas
        ref={canvasRef}
        className={`overlay__canvas ${mode === 'draw' ? 'overlay__canvas--active' : ''}`}
        data-testid="telestration-canvas"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerEnd}
        onPointerCancel={handlePointerEnd}
      />
      <Toolbar
        mode={mode}
        onModeChange={setMode}
        tool={tool}
        onToolChange={setTool}
        color={color}
        onColorChange={setColor}
        width={width}
        onWidthChange={setWidth}
        canUndo={strokesRef.current.length > 0}
        onUndo={undo}
        onClear={clear}
      />
    </div>
  )
}
