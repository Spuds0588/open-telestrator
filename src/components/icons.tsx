import {
  Circle,
  Highlighter,
  Joystick,
  ListVideo,
  Pencil,
  Radio,
  Rewind,
  SlidersVertical,
  Square,
  Users,
  type LucideIcon,
} from 'lucide-react'
import type { PanelId } from '../lib/panels'
import type { Tool } from '../lib/telestration'

/**
 * The app's icon set: Lucide's outline glyphs, bundled at build time — nothing
 * is fetched while the studio runs.
 *
 * Every icon is stroked in `currentColor` and filled with nothing, so the
 * control's own colour drives it: muted at rest, white when it is the active
 * tile. Only the icons actually used are imported, so the rest of the set never
 * reaches the bundle.
 */

/** The rail: one glyph per panel, exhaustive by type. */
export const PANEL_ICONS: Record<PanelId, LucideIcon> = {
  draw: Pencil,
  input: ListVideo,
  audio: SlidersVertical,
  replay: Rewind,
  cohosts: Users,
  broadcast: Radio,
  // A joystick, not a gamepad: the Audio panel already spends the gamepad on
  // the console's sound, and Hardware is the pedals and controllers themselves.
  hardware: Joystick,
}

/** The drawing tools, in the order the toolbar shows them. */
export const TOOL_ICONS: Record<Tool, LucideIcon> = {
  pen: Pencil,
  highlight: Highlighter,
  rect: Square,
  ellipse: Circle,
}

/** Rail tiles carry a bigger glyph, so theirs is drawn with a lighter stroke. */
export const RAIL_STROKE = 1.75
