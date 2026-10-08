import { useEffect, useRef, useState, type RefObject } from 'react'
import {
  COMPOSITE_FPS,
  COMPOSITE_HEIGHT,
  COMPOSITE_WIDTH,
  cornerBox,
  fitInRect,
  type Rect,
} from './composite'
import { startFrameLoop } from './frameLoop'
import { drawStroke, type Stroke } from './telestration'

/** How often the picture is rebuilt while the tab is hidden, in milliseconds. */
const HIDDEN_REDRAW_MS = 1000

export interface CompositorOptions {
  /** Composite only while viewers are being fed. */
  active: boolean
  /** The stage's main video: the live program, or the replay clip. */
  videoRef: RefObject<HTMLVideoElement>
  /** The live program, shown top-right while a replay plays. */
  liveRef: RefObject<HTMLVideoElement>
  /** The corner cameras: one element per overlay box, bottom-right then left. */
  cornerRef: RefObject<HTMLVideoElement>
  cornerLeftRef: RefObject<HTMLVideoElement>
  /** The committed strokes, drawn over everything. */
  strokes: readonly Stroke[]
  /** Whether the stage is showing a replay right now. */
  replaying: boolean
}

/**
 * The program compositor.
 *
 * The stage is the program: whatever the host sees — the selected video, the
 * live corner while a replay plays, the two corner cameras, and the
 * telestration strokes — is drawn onto one canvas whose stream becomes the
 * broadcast. That is what puts drawings and overlays in front of viewers, and
 * it is why the composited track never changes identity: switching source,
 * corner or strokes redraws the picture instead of re-publishing the stream,
 * so viewers keep watching.
 *
 * The canvas is not in the document; nothing needs to see it but WebRTC.
 */
export function useProgramCompositor({
  active,
  videoRef,
  liveRef,
  cornerRef,
  cornerLeftRef,
  strokes,
  replaying,
}: CompositorOptions): MediaStream | null {
  const [stream, setStream] = useState<MediaStream | null>(null)
  const strokesRef = useRef(strokes)
  const replayingRef = useRef(replaying)

  useEffect(() => {
    strokesRef.current = strokes
  }, [strokes])

  useEffect(() => {
    replayingRef.current = replaying
  }, [replaying])

  useEffect(() => {
    if (!active) {
      setStream(null)
      return
    }

    const canvas = document.createElement('canvas')
    canvas.width = COMPOSITE_WIDTH
    canvas.height = COMPOSITE_HEIGHT
    const ctx = canvas.getContext('2d', { alpha: false })
    if (!ctx || typeof canvas.captureStream !== 'function') {
      setStream(null)
      return
    }

    const frame: Rect = { x: 0, y: 0, width: COMPOSITE_WIDTH, height: COMPOSITE_HEIGHT }
    const liveBox = cornerBox(COMPOSITE_WIDTH, COMPOSITE_HEIGHT, 'top-right')
    const camBox = cornerBox(COMPOSITE_WIDTH, COMPOSITE_HEIGHT, 'bottom-right')
    const camLeftBox = cornerBox(COMPOSITE_WIDTH, COMPOSITE_HEIGHT, 'bottom-left')

    const drawSource = (video: HTMLVideoElement | null, box: Rect) => {
      if (!video || video.readyState < 2 || video.videoWidth === 0) return
      const rect = fitInRect(video.videoWidth, video.videoHeight, box)
      ctx.drawImage(video, rect.x, rect.y, rect.width, rect.height)
    }

    const draw = () => {
      ctx.fillStyle = '#000'
      ctx.fillRect(0, 0, COMPOSITE_WIDTH, COMPOSITE_HEIGHT)
      drawSource(videoRef.current, frame)
      if (replayingRef.current) drawSource(liveRef.current, liveBox)
      drawSource(cornerRef.current, camBox)
      drawSource(cornerLeftRef.current, camLeftBox)
      // Strokes are drawn one by one, not through `renderStrokes`: that helper
      // clears its canvas first, which would wipe the video underneath.
      for (const stroke of strokesRef.current) {
        drawStroke(ctx, stroke, COMPOSITE_WIDTH, COMPOSITE_HEIGHT)
      }
    }

    const composited = canvas.captureStream(COMPOSITE_FPS)
    setStream(composited)
    const stopLoop = startFrameLoop(draw, HIDDEN_REDRAW_MS)

    return () => {
      stopLoop()
      composited.getTracks().forEach((track) => track.stop())
    }
  }, [active, videoRef, liveRef, cornerRef, cornerLeftRef])

  return stream
}
