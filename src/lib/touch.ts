/**
 * Phones, tablets, styluses — and the viewports that are none of those.
 *
 * The studio was laid out for a 1440-wide window with a mouse. A tablet held in
 * portrait, a phone in landscape and a foldable half-open are all narrower than
 * that, and a stylus is not a mouse: it reports pressure, and the hand resting on
 * the glass reports touches of its own.
 *
 * A phone in a browser is a first-class way to run this now that there is no app
 * to send it to, so this is not a shell-only story: every viewport gets an
 * answer, and the answer for something held in a hand is the rail along the
 * bottom with a sheet for the panel.
 *
 * The decisions about all of that live here rather than in the components, for
 * the usual reason: "which layout is this and may this pointer draw" is exactly
 * the sort of thing that breaks quietly on the one device nobody tested. The
 * component asks; this decides.
 */

/**
 * The short side a control needs to be pressed reliably with a fingertip.
 *
 * `AGENTS.md` sets the floor at 40px; this is the number the touch layout
 * actually aims for, and the one a new control should be checked against.
 */
export const MIN_TARGET = 44

export type FormFactor = 'desktop' | 'tablet' | 'phone'
export type Orientation = 'portrait' | 'landscape'

export interface Layout {
  form: FormFactor
  orientation: Orientation
  /** The rail runs down the side of the stage, or along the bottom as a bar. */
  rail: 'side' | 'bottom'
  /** The open panel is a column beside the stage, or a sheet over it. */
  panel: 'column' | 'sheet'
  /** Controls are sized for a fingertip or a stylus rather than a mouse. */
  touch: boolean
}

/**
 * Below this the rail costs more than it earns: the side rail is 92px, the panel
 * 280px, so at 1024 the stage still has more than half the window and below it
 * does not.
 */
export const SIDE_RAIL_MIN_WIDTH = 1024

const MOBILE_UA = /android|iphone|ipad|ipod|mobile/i
const TABLET_UA = /ipad|tablet|playbook|silk/i

/** Whether a user agent describes a phone or a tablet at all. */
export function isMobileUserAgent(userAgent: string): boolean {
  return MOBILE_UA.test(userAgent ?? '')
}

export interface Viewport {
  width: number
  height: number
}

/**
 * Which shape of device this is.
 *
 * The user agent is the only thing that knows a phone from a tablet: both report
 * the same viewport, and a tablet in a landscape window is wider than a desktop
 * in a portrait one. Android tablets are the awkward case — their user agent
 * carries no `Mobile` token, which is exactly the fact that identifies them.
 *
 * A user agent that says nothing at all is taken for a desktop: a mouse-driven
 * window keeps the rail it has always had however narrow it is made, which is
 * what the old short-side fallback used to get wrong.
 */
export function detectFormFactor(userAgent: string, viewport: Viewport): FormFactor {
  const ua = userAgent ?? ''
  if (TABLET_UA.test(ua) || (MOBILE_UA.test(ua) && /android/i.test(ua) && !/mobile/i.test(ua))) {
    return 'tablet'
  }
  if (/iphone|ipod/i.test(ua)) return 'phone'
  if (MOBILE_UA.test(ua)) return Math.min(viewport.width, viewport.height) >= 600 ? 'tablet' : 'phone'
  // Nothing in the user agent that says otherwise: a desktop browser, at
  // whatever shape its window happens to be. A mouse-driven window keeps the
  // rail it has always had rather than being mistaken for a phone the moment it
  // is made narrow, which is what the short-side rule would do here.
  return 'desktop'
}

/**
 * The layout for this viewport. Always an answer: there is no shell to defer to
 * and no unsupported-device notice any more — a phone in a browser gets the
 * studio, laid out for a hand.
 *
 * Every viewport gets an answer, including the strange ones, because a window
 * can be resized to any shape at all and a tablet can be rotated mid-broadcast.
 */
export function layoutFor(input: {
  userAgent: string
  width: number
  height: number
  /** Whether the primary pointer is coarse — a finger or a stylus. */
  touch: boolean
}): Layout {
  const { userAgent, width, height, touch } = input

  const form = detectFormFactor(userAgent, { width, height })
  const orientation: Orientation = height > width ? 'portrait' : 'landscape'
  const roomy = width >= SIDE_RAIL_MIN_WIDTH

  // A phone or a tablet is held, whatever the primary pointer reports — a
  // detachable keyboard, or a tablet that answers `pointer: coarse` with false.
  // Everything else is a mouse until told otherwise.
  const tactile = touch || form !== 'desktop'

  // A mouse-driven window keeps the rail it has always had, however narrow: it
  // is a window the operator chose, and the stage still gets half of it. A held
  // device that is not roomy gets the rail out of the way along the bottom.
  const bottom = form === 'phone' || (!roomy && tactile)

  return {
    form,
    orientation,
    rail: bottom ? 'bottom' : 'side',
    panel: bottom ? 'sheet' : 'column',
    touch: tactile,
  }
}

// --- stylus ----------------------------------------------------------------

/** Whether a pointer came from a pen rather than a finger or a mouse. */
export function isStylus(pointerType: string | undefined): boolean {
  return pointerType === 'pen'
}

/**
 * What a device with no pressure sensor reports: the middle of the range.
 * A finger, a mouse and a trackpad all report this, which is why the pressure
 * rule below leaves them untouched.
 */
export const NEUTRAL_PRESSURE = 0.5

/** How far pressure may thin or thicken a stroke. */
export const PRESSURE_MIN = 0.6
export const PRESSURE_MAX = 1.6

/**
 * The width a stroke starts at, given the pressure that started it.
 *
 * A stylus that presses harder draws a bolder line — which is what a pen does,
 * and what an operator drawing over a small figure in a wide shot wants. Doubling
 * the reported pressure puts the neutral reading at the width as configured, so
 * a finger, a mouse and a stylus held lightly all draw the same line and only a
 * deliberate press changes it.
 *
 * The width is fixed for the rest of the stroke: a stroke is one number on the
 * wire, shared with the co-hosts, and a line that thickens along its length would
 * be a change to that protocol rather than to this rule.
 */
export function strokeWidth(base: number, pressure: number): number {
  const reported = Number.isFinite(pressure) && pressure > 0 ? pressure : NEUTRAL_PRESSURE
  const factor = Math.min(PRESSURE_MAX, Math.max(PRESSURE_MIN, reported * 2))
  return base * factor
}

/** How long a stylus counts as "in use" after its last event. */
export const PALM_WINDOW_MS = 1500

/**
 * Whether this pointer is the heel of a hand rather than an intent.
 *
 * A hand resting on the glass sends touches, and a telestrator that commits them
 * draws random lines on air. Once a stylus has been seen on this canvas every
 * touch for the next moment and a half is refused; a mouse never is, and a pen
 * never is. Draw with a finger and nothing is refused, because a finger that has
 * never shared the screen with a stylus is somebody drawing with a finger.
 */
export function isPalm(input: {
  pointerType: string | undefined
  /** When the stylus was last heard from, or null if it never was. */
  lastStylusMs: number | null
  now: number
}): boolean {
  const { pointerType, lastStylusMs, now } = input
  if (pointerType !== 'touch') return false
  if (lastStylusMs === null) return false
  return now - lastStylusMs <= PALM_WINDOW_MS
}
