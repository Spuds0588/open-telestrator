/**
 * The stage's input model.
 *
 * The app can hold several sources at once — the host's shared screen and any
 * number of incoming cameraman feeds — but exactly one is selected as the
 * program stream. `VideoStage` (and therefore replay and the audio mixer) only
 * ever sees that single selected stream, so adding sources changes nothing about
 * how capture, telestration, replay, or audio behave.
 */
export type SourceKind = 'screen' | 'camera'

export interface StageSource {
  /** Stable while the source is alive, e.g. `screen` or `camera:<peer id>`. */
  id: string
  label: string
  kind: SourceKind
  stream: MediaStream
}
