import { useEffect, useRef } from 'react'
import { TelestrationOverlay } from './TelestrationOverlay'
import { ReplayControls } from './ReplayControls'
import { AudioControls } from './AudioControls'
import { REPLAY_RATE, useReplay } from '../lib/useReplay'
import type { AudioController } from '../lib/useAudioMixer'
import { type Stroke, type Tool, type Gesture } from '../lib/telestration'

/** The 16:9 stage: the captured video (or a replay of it) with the telestration
 * canvas layered on top and the replay/audio controls in the corner. */
export function VideoStage({
  stream,
  past,
  tool,
  color,
  width,
  audio,
  onStrokeCommitted,
}: {
  stream: MediaStream | null
  /** Committed strokes owned by the host (App). The canvas paints these
   * imperatively and re-paints whenever the list changes. */
  past: Stroke[]
  /** The active drawing tool. */
  tool: Tool
  /** The active stroke colour. */
  color: string
  /** The active stroke width. */
  width: number
  /** Stage audio controls, owned by App so the input picker can use them. */
  audio: AudioController
  /** Called once per completed gesture with the gesture to commit. */
  onStrokeCommitted: (gesture: Gesture & { id: string }) => void
}) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const replay = useReplay(stream, videoRef)
  const clip = replay.clip

  // One binding effect for both modes: the same element shows live video via
  // `srcObject`, and a replay via a blob URL at half speed.
  useEffect(() => {
    const video = videoRef.current
    if (!video) return

    if (clip) {
      const url = URL.createObjectURL(clip.blob)
      video.pause()
      video.srcObject = null
      video.removeAttribute('src')
      video.src = url
      video.playbackRate = REPLAY_RATE

      const seek = () => {
        video.currentTime = clip.startSeconds
        void video.play().catch(() => undefined)
      }
      if (video.readyState >= HTMLMediaElement.HAVE_METADATA) seek()
      else video.addEventListener('loadedmetadata', seek, { once: true })

      return () => {
        video.removeEventListener('loadedmetadata', seek)
        URL.revokeObjectURL(url)
      }
    }

    video.removeAttribute('src')
    video.srcObject = stream
    if (stream) void video.play().catch(() => undefined)
    return () => {
      video.srcObject = null
    }
  }, [stream, clip])

  return (
    <div className="screen" data-testid="screen">
      <video ref={videoRef} className="screen__video" muted playsInline />
      {!stream && !replay.replaying && <div className="screen__empty">No signal</div>}
      <TelestrationOverlay
        strokes={past}
        tool={tool}
        color={color}
        width={width}
        onStrokeCommitted={onStrokeCommitted}
      />
      <ReplayControls {...replay} />
      <AudioControls {...audio} />
    </div>
  )
}
