/**
 * Program compositor geometry.
 *
 * The stage is the program: the compositor draws the same picture the host sees
 * — the selected video letterboxed into the 16:9 frame, the "live" corner while
 * a replay plays, the camera overlays, then the telestration strokes — onto one
 * canvas whose stream is broadcast to viewers.
 *
 * These helpers are pure so the picture can be unit-tested without a canvas.
 * The corner boxes are 16:9 so the DOM stage can mirror them with
 * `aspect-ratio` CSS: keep `CORNER_*` in step with `index.css`.
 *
 * There are two camera overlay boxes, one per bottom corner, so a host's corner
 * camera and a phone's can be on air at once. Which source sits in which box is
 * a plain record with its own rules here rather than state spread over the
 * components.
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

/**
 * Which corner an overlay sits in. The live program keeps the top-right while a
 * replay plays; the two camera overlays sit in the bottom boxes, one each side.
 */
export type Corner = 'top-right' | 'bottom-right' | 'bottom-left'

/** The fixed 16:9 box a corner overlay occupies. */
export function cornerBox(frameWidth: number, frameHeight: number, corner: Corner): Rect {
  const width = frameWidth * CORNER_WIDTH_SHARE
  const height = width / CORNER_ASPECT
  const insetX = frameWidth * CORNER_INSET_SHARE
  const insetY = frameHeight * CORNER_INSET_SHARE
  return {
    x: corner === 'bottom-left' ? insetX : frameWidth - width - insetX,
    y: corner === 'top-right' ? insetY : frameHeight - height - insetY,
    width,
    height,
  }
}

/**
 * The camera overlays that can be on air at once: one box per bottom corner, so
 * the host's corner camera and a phone's can be held on the program together.
 * The top-right belongs to the live corner while a replay plays.
 */
export const OVERLAY_CORNERS = ['bottom-right', 'bottom-left'] as const

export type OverlayCorner = (typeof OVERLAY_CORNERS)[number]

/** Which source each overlay box is showing. `null` is an empty box. */
export type OverlaySources = Record<OverlayCorner, string | null>

/** Both boxes empty — where a session starts. */
export const NO_OVERLAYS: OverlaySources = {
  'bottom-right': null,
  'bottom-left': null,
}

/**
 * Put a source in one overlay box, or `null` to empty it. An input is on air in
 * one box at a time, so a source that was in the other box moves rather than
 * being carried twice.
 */
export function assignOverlay(
  current: OverlaySources,
  corner: OverlayCorner,
  sourceId: string | null,
): OverlaySources {
  if (current[corner] === sourceId) return current
  const next: OverlaySources = { ...current }
  for (const box of OVERLAY_CORNERS) {
    if (box !== corner && next[box] === sourceId) next[box] = null
  }
  next[corner] = sourceId
  return next
}

/**
 * Empty the boxes whose source has gone away or has become the program itself,
 * so a corner never shows a dead feed or the picture twice. The same object
 * comes back when nothing changed, which lets React skip the re-render.
 */
export function pruneOverlays(
  current: OverlaySources,
  available: readonly { id: string }[],
  programId: string | null,
): OverlaySources {
  let next = current
  for (const box of OVERLAY_CORNERS) {
    const id = current[box]
    if (id === null) continue
    const gone = id === programId || !available.some((source) => source.id === id)
    if (!gone) continue
    if (next === current) next = { ...current }
    next[box] = null
  }
  return next
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
