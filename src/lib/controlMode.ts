/**
 * Draw mode and Control mode, as the webview sees them.
 *
 * The rules are here rather than in the component because "which mode are we
 * in, and what does it mean" is exactly the kind of thing that breaks quietly:
 * a stray drag committed in Control mode is a stroke the operator never meant
 * to draw, on air, mid-sentence.
 *
 * Control mode is desktop-only. On the web the canvas always draws and never
 * passes a click to the page underneath, because a browser tab has no way to
 * hand a click through — so `DEFAULT_MODE` is the only mode the web build ever
 * sees.
 */

export type ControlMode = 'draw' | 'control'

/** Draw is the default: a telestrator that starts by not drawing is not one. */
export const DEFAULT_MODE: ControlMode = 'draw'

export function toggle(mode: ControlMode): ControlMode {
  return mode === 'draw' ? 'control' : 'draw'
}

/**
 * Whether a pointer event may commit a stroke. In Control mode the whole window
 * ignores cursor events, so in principle no event ever arrives — but the canvas
 * is also given `pointer-events: none`, so a platform whose pass-through
 * misbehaves still cannot put an accidental stroke on air.
 */
export function canDraw(mode: ControlMode): boolean {
  return mode === 'draw'
}

/** The switch's own label. */
export function label(mode: ControlMode): string {
  return mode === 'draw' ? 'Draw' : 'Control'
}

/** One sentence on what the current mode means, for under the switch. */
export function hint(mode: ControlMode): string {
  return mode === 'draw'
    ? 'The pointer draws, and the strokes go on air.'
    : 'The pointer belongs to whatever is under the window.'
}

/**
 * The class the body wears in Control mode. The CSS hangs off this to step the
 * chrome out of the way so the window is a clear pane over whatever is beneath
 * it, which is the only way a click-through overlay is useful.
 */
export function bodyClass(mode: ControlMode): string {
  return mode === 'control' ? 'control' : ''
}

/**
 * The shortcut as it is printed on this platform. Matches what
 * `src-tauri/src/control.rs` registers: Cmd on macOS, Control elsewhere.
 */
export function shortcutLabel(platform: string): string {
  return platform.toLowerCase().includes('mac') ? 'Cmd+Shift+D' : 'Ctrl+Shift+D'
}

/**
 * The line left on the window while Control mode is on.
 *
 * Control mode hides the chrome and hands the pointer to whatever is under the
 * window, so this is the only control that survives it — and it cannot be a
 * button, because by definition nothing on this window can be clicked. Text
 * still works where a button cannot: the window is visible even when it is not
 * clickable, so the one thing the operator needs to be told mid-mode is how to
 * leave it. Relying on them having read the panel beforehand is what made the
 * mode look like a one-way door.
 */
export function escapeHint(platform: string): string {
  return `Control mode — press ${shortcutLabel(platform)} to draw again`
}

/**
 * The platform string the shortcut is read from, in one place so the rail's
 * tooltip, this hint and `src-tauri/src/control.rs` cannot disagree.
 */
export function platformName(): string {
  if (typeof navigator === 'undefined') return ''
  return navigator.platform || navigator.userAgent
}

/**
 * Whether the app should offer Control mode at all. It is a window behaviour,
 * so only the desktop build has it; the web build keeps its seven rail tiles.
 */
export function offersControlMode(isDesktop: boolean): boolean {
  return isDesktop
}
