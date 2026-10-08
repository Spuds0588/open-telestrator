import { useState } from 'react'
import { Smartphone } from 'lucide-react'
import { LANDSCAPE_NUDGE_KEY, shouldSuggestLandscape, type Layout } from '../lib/touch'

/**
 * The one time the studio asks for something other than a tap: a phone held
 * upright gets a full-screen note to turn it on its side.
 *
 * The studio is laid out for a landscape window. Turned over, a phone gets one
 * row of controls across the top and a stage that fills the height; upright, the
 * rail has to stack into rows and the stage keeps less than half the screen. That
 * is worth saying plainly once — there is no app to install and no device notice
 * to read, so this is the only place the shape of the screen is ever mentioned.
 *
 * Dismissing it is real: the note is remembered for the session, so it does not
 * come back the moment the operator turns the phone back upright, and a fresh
 * visit asks again. Rotating hides it by itself, because the layout stops
 * matching — there is no state to clear.
 */
export function OrientationPrompt({ layout }: { layout: Layout | null }) {
  const [dismissed, setDismissed] = useState(readDismissed)

  if (!layout || dismissed || !shouldSuggestLandscape(layout)) return null

  return (
    <div className="nudge" data-testid="orientation-nudge" role="dialog" aria-modal="true">
      <div className="nudge__panel">
        <Smartphone className="nudge__icon" aria-hidden="true" />
        <h2 className="nudge__title">Turn your phone sideways</h2>
        <p className="nudge__text">
          The studio is built for landscape: the controls sit in one row along the bottom, the
          panel moves beside the picture, and the stage keeps the rest of the height. Upright
          the controls stack into two rows and the panel takes the middle, which leaves the
          picture about a third of the screen.
        </p>
        <button
          type="button"
          className="btn"
          data-testid="orientation-dismiss"
          onClick={() => {
            writeDismissed()
            setDismissed(true)
          }}
        >
          Carry on upright
        </button>
      </div>
    </div>
  )
}

/** Whether this session has already been asked. Private mode can refuse the
 *  storage entirely, and a prompt that throws is worse than one that reappears. */
function readDismissed(): boolean {
  try {
    return window.sessionStorage.getItem(LANDSCAPE_NUDGE_KEY) === '1'
  } catch {
    return false
  }
}

function writeDismissed(): void {
  try {
    window.sessionStorage.setItem(LANDSCAPE_NUDGE_KEY, '1')
  } catch {
    // Nothing to do: the note simply shows again next time.
  }
}
