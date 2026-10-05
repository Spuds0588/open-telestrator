/**
 * Program compositor geometry.
 *
 * The stage is the program: the compositor draws the same picture the host sees
 * — the selected video letterboxed into the 16:9 frame, the "live" corner while
 * a replay plays, the commentator's corner camera, then the telestration
 * strokes — onto one canvas whose stream is broadcast to viewers.
 *
 * These helpers are pure so the picture can be unit-tested without a canvas.
 * The corner boxes are 16:9 so the DOM stage can mirror them with
 * `aspect-ratio` CSS: keep `CORNER_*` in step with `index.css`.
 */

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

/** The composited frame's logical size, matching the stage. */
export const COMPOSITE_WIDTH = 1280
export const COMPOSITE_HEIGHT = 720

/** Capture rate for the composited stream. 30 fps is plenty for telestration. */
export const COMPOSITE_FPS = 30

/** Corner boxes are this share of the frame's width… */
export const CORNER_WIDTH_SHARE = 0.3

/** …inset from the frame edges by this share of its width/height… */
export const CORNER_INSET_SHARE = 0.025

/** …and always 16:9, whatever the source's own shape. */
export const CORNER_ASPECT = 16 / 9

/** Which corner an overlay sits in. The cam sits bottom-right, live top-right. */
export type Corner = 'top-right' | 'bottom-right'

/** The fixed 16:9 box a corner overlay occupies. */
export function cornerBox(frameWidth: number, frameHeight: number, corner: Corner): Rect {
  const width = frameWidth * CORNER_WIDTH_SHARE
  const height = width / CORNER_ASPECT
  const insetX = frameWidth * CORNER_INSET_SHARE
  const insetY = frameHeight * CORNER_INSET_SHARE
  return {
    x: frameWidth - width - insetX,
    y: corner === 'top-right' ? insetY : frameHeight - height - insetY,
    width,
    height,
  }
}

/**
 * Fit a source into a box without distortion (letterbox or pillarbox), centred.
 * Used both for the program video in the full frame and for corner overlays.
 */
export function fitInRect(
  sourceWidth: number,
  sourceHeight: number,
  box: Rect,
): Rect {
  if (sourceWidth <= 0 || sourceHeight <= 0) return { ...box }
  const scale = Math.min(box.width / sourceWidth, box.height / sourceHeight)
  const width = sourceWidth * scale
  const height = sourceHeight * scale
  return {
    x: box.x + (box.width - width) / 2,
    y: box.y + (box.height - height) / 2,
    width,
    height,
  }
}
