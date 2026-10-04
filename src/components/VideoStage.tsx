import { useEffect, useRef } from 'react'
import { TelestrationOverlay } from './TelestrationOverlay'
import { ReplayControls } from './ReplayControls'
import { AudioControls } from './AudioControls'
import { REPLAY_RATE, useReplay } from '../lib/useReplay'
import { useAudioMixer } from '../lib/useAudioMixer'

/**
 * The 16:9 stage: the captured video (or a replay of it) with the telestration
 * canvas layered on top and the replay controls in the corner.
 */
export function VideoStage({ stream }: { stream: MediaStream | null }) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const replay = useReplay(stream, videoRef)
  const audio = useAudioMixer(stream)
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
      <TelestrationOverlay />
      <ReplayControls {...replay} />
      <AudioControls {...audio} />
    </div>
  )
}
