/**
 * The stage's input model.
 *
 * The app can hold several sources at once — the host's shared screen, the
 * host's webcam, and any number of incoming cameraman feeds — but exactly one is
 * selected as the program stream. `VideoStage` (and therefore replay and the
 * audio mixer) only ever sees that single selected stream, so adding sources
 * changes nothing about how capture, telestration, replay, or audio behave.
 */
export type SourceKind = 'screen' | 'camera'

export interface StageSource {
  /** Stable while the source is alive, e.g. `screen` or `camera:<peer id>`. */
  id: string
  label: string
  kind: SourceKind
  stream: MediaStream
}

/** A cameraman feed, structurally satisfied by `useHostCamera`'s CameraSource. */
export interface CameraFeed {
  id: string
  label: string
  stream: MediaStream
}

/**
 * Assemble the stage's source list, in program order: the shared screen, the
 * host's webcam, then every cameraman currently streaming in.
 *
 * Pure so the source list can be unit-tested: assembling it is what decides
 * whether the stage, replay and audio ever see a stream.
 */
export function mergeStageSources(
  screen: MediaStream | null,
  webcam: MediaStream | null,
  cameras: readonly CameraFeed[],
): StageSource[] {
  const list: StageSource[] = []
  if (screen) {
    list.push({ id: 'screen', label: 'Shared screen', kind: 'screen', stream: screen })
  }
  if (webcam) {
    list.push({ id: 'webcam', label: 'Webcam', kind: 'camera', stream: webcam })
  }
  for (const camera of cameras) {
    list.push({
      id: `camera:${camera.id}`,
      label: camera.label,
      kind: 'camera',
      stream: camera.stream,
    })
  }
  return list
}
