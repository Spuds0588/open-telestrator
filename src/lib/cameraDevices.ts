/**
 * The input kinds the host can bring onto the stage.
 *
 * `Screen` captures a shared tab or window, `Camera` opens the host's own
 * webcam, and `Audio` is a live microphone mixed by the stage audio graph. The
 * sidebar lists them and each one starts its capture when selected.
 */
export type SupportedInput = 'screen' | 'camera' | 'audio'

/** A human-facing label and hint for a supported input, shown in the sidebar. */
export interface InputKind {
  kind: SupportedInput
  label: string
  hint: string
  glyph: string
}

export const INPUT_KINDS: InputKind[] = [
  {
    kind: 'screen',
    label: 'Screen',
    hint: 'A tab, window or desktop capture',
    glyph: '🖥',
  },
  {
    kind: 'camera',
    label: 'Camera',
    hint: 'The host camera (webcam or built-in)',
    glyph: '🎥',
  },
  {
    kind: 'audio',
    label: 'Audio',
    hint: 'The announcer microphone',
    glyph: '🎙',
  },
]

/** Coarse state of an input, used for the sidebar's one-line status. */
export type InputPhase = 'off' | 'requesting' | 'live' | 'problem'

/** One-line status for the selected input kind. */
export function inputStatusText(kind: SupportedInput, phase: InputPhase): string {
  if (kind === 'screen') {
    switch (phase) {
      case 'requesting':
        return 'Waiting for the tab picker…'
      case 'live':
        return 'Screen capture is live — pick it in Feed.'
      case 'problem':
        return 'Screen capture failed — select Screen to try again.'
      default:
        return 'Screen off — select Screen to share a tab or window.'
    }
  }

  if (kind === 'camera') {
    switch (phase) {
      case 'requesting':
        return 'Waiting for camera permission…'
      case 'live':
        return 'The host camera is live — pick it in Feed.'
      case 'problem':
        return 'The camera could not start — select Camera to try again.'
      default:
        return 'Camera off — select Camera to go live.'
    }
  }

  switch (phase) {
    case 'requesting':
      return 'Waiting for microphone permission…'
    case 'live':
      return 'The microphone is mixed into the stage audio.'
    case 'problem':
      return 'Microphone access failed — select Audio to try again.'
    default:
      return 'Microphone off — select Audio to enable it.'
  }
}
