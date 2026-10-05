/**
 * The stage's input model.
 *
 * The app can hold several sources at once — the host's shared screen, any
 * number of the host's own cameras, opened video files or streams, and every
 * incoming cameraman feed — but exactly one is selected as the program stream.
 * `VideoStage` (and therefore replay, audio and the broadcast compositor) only
 * ever sees that single selected stream, so adding sources changes nothing about
 * how capture, telestration, replay, or audio behave.
 */
export type SourceKind = 'screen' | 'camera' | 'media'

export interface StageSource {
  /** Stable while the source is alive, e.g. `screen` or `cam:<device id>`. */
  id: string
  label: string
  kind: SourceKind
  stream: MediaStream
}

/** One live feed, structurally shared by host cameras, opened media and cameraman feeds. */
export interface StageFeed {
  id: string
  label: string
  stream: MediaStream
}

/**
 * Assemble the stage's source list, in program order: the shared screen, the
 * host's own cameras (in the order they were added), opened video files and
 * streams, then every cameraman currently streaming in.
 *
 * Pure so the source list can be unit-tested: assembling it is what decides
 * whether the stage, replay, audio and the broadcast ever see a stream.
 */
export function mergeStageSources(
  screen: MediaStream | null,
  hostCameras: readonly StageFeed[],
  media: readonly StageFeed[],
  cameramen: readonly StageFeed[],
): StageSource[] {
  const list: StageSource[] = []
  if (screen) {
    list.push({ id: 'screen', label: 'Shared screen', kind: 'screen', stream: screen })
  }
  for (const camera of hostCameras) {
    list.push({ id: camera.id, label: camera.label, kind: 'camera', stream: camera.stream })
  }
  for (const feed of media) {
    list.push({ id: feed.id, label: feed.label, kind: 'media', stream: feed.stream })
  }
  for (const camera of cameramen) {
    list.push({ id: camera.id, label: camera.label, kind: 'camera', stream: camera.stream })
  }
  return list
}
