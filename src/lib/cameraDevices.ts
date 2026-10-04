/** Every kind of device the host may select as an input. The UI lists the real
 * `enumerateDevices()` kinds; the kind is used as the stable `id` prefix below. */
export type DeviceKind = 'screen' | 'camera' | 'audio'

/** The input types the host advertises as selectable. `Screen` captures the
 * shared screen (or window) via `getDisplayMedia`; `Camera` captures a live
 * photo/video device; `Audio` is a live microphone. Only a `screen` or a
 * `camera` can be the program stream. */
export type SupportedInput = 'screen' | 'camera' | 'audio'

/** A human-facing label and hint for a supported input, shown in the sidebar. */
export interface InputKind {
  kind: SupportedInput
  label: string
  hint: string
  glyph: string
}

/** The inputs the host actually offers. `Audio` is exposed as an input kind so
 * the sidebar can list it, but it never becomes a program feed on its own. */
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
    hint: 'A live video feed (phone camera, webcam)',
    glyph: '🎥',
  },
  {
    kind: 'audio',
    label: 'Audio',
    hint: 'A live microphone feed',
    glyph: '🎙',
  },
]

/** Which device kinds produce a `StageSource` we can select as the program
 * input. Screen and camera always; audio only when explicitly enabled by the
 * host, because a bare audio track has no video to paint telestration on. */
export function kindIsSelectable(kind: SupportedInput): boolean {
  return kind === 'screen' || kind === 'camera'
}

/**
 * Represents a live device reported by `enumerateDevices()`, tagged with the
 * app's own `kind` so the sidebar can group it (screen / camera / audio).
 *
 * `MediaDeviceInfo.kind` is a `MediaDeviceKind` ('videoinput' | 'audioinput' |
 * 'videooutput' | 'audiooutput'), so we keep that through `device.kind` and add
 * the app's own `kind` field as a separate, app-scoped property.
 */
export interface LiveDeviceInfo {
  deviceId: string
  kind: DeviceKind
  label?: string
  groupId?: string
}

/** All devices reported by the platform so far. Populated by `startWatching`. */
export interface DeviceSnapshot {
  cameras: Map<string, LiveDeviceInfo>
  microphones: Map<string, LiveDeviceInfo>
  screens: Map<string, LiveDeviceInfo>
  /** Human-readable labels for each selectable input, keyed by `kind`.
   * The host uses these to populate the sidebar's input picker. */
  labels: Map<SupportedInput, string>
  /** Re-run this periodically while the app is open so a newly attached camera
   * or a changed input name shows up in the sidebar. */
  stopWatching: () => void
  /** Re-run the snapshot now. */
  refresh: () => void
}

const CAMERA_KINDS = new Set<string>(['video'])
const MIC_KINDS = new Set<string>(['audio'])

/**
 * Group live devices by `kind` (screen / camera / audio) so the sidebar can
 * render a mini preview of everything it can switch to or invite.
 *
 * `enumerateDevices` is async and may be called before the user interacts with
 * the page on some browsers, so this returns a disposable snapshot and a
 * refresh callback rather than caching forever.
 */
export async function scanDevices(): Promise<DeviceSnapshot> {
  const cameras = new Map<string, LiveDeviceInfo>()
  const microphones = new Map<string, LiveDeviceInfo>()
  const screens = new Map<string, LiveDeviceInfo>()

  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.enumerateDevices) {
    return { cameras, microphones, screens, labels: new Map(), stopWatching: () => undefined, refresh: () => undefined }
  }

  const devices = await navigator.mediaDevices.enumerateDevices()
  for (const device of devices) {
    const kind: DeviceKind = CAMERA_KINDS.has(device.kind) ? 'camera' : MIC_KINDS.has(device.kind) ? 'audio' : 'screen'
    const info: LiveDeviceInfo = { deviceId: device.deviceId, kind, label: device.label, groupId: device.groupId }
    if (info.kind === 'camera') {
      cameras.set(device.deviceId, info)
    } else if (info.kind === 'audio') {
      microphones.set(device.deviceId, info)
    } else {
      screens.set(device.deviceId, info)
    }
  }

  const labels = new Map<SupportedInput, string>([
    ['screen', 'Screen (shared browser tab or window)'],
    ['camera', 'Camera (phone camera or webcam)'],
    ['audio', 'Audio (live microphone)'],
  ])

  const stopWatching = () => undefined
  const refresh = () => scanDevices().then((next) => ({
    cameras: next.cameras,
    microphones: next.microphones,
    screens: next.screens,
    labels: next.labels,
    stopWatching,
    refresh,
  }))

  return { cameras, microphones, screens, labels, stopWatching, refresh }
}
