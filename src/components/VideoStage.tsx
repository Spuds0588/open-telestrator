import { useEffect, useRef, useState, type RefObject } from 'react'
import { TelestrationOverlay } from './TelestrationOverlay'
import { REPLAY_RATE } from '../lib/useReplay'
import type { ReplayClip } from '../lib/replay'
import { type Stroke, type Tool, type Gesture } from '../lib/telestration'

/** Logical stage size (16:9). The whole frame is scaled with `transform` to fit
 * the available area, so the video keeps its ratio and the sidebar's width is
 * never affected by the stage's content. */
const STAGE_WIDTH = 1280
const STAGE_HEIGHT = 720

/** The 16:9 stage: the captured video (or a replay of it) with the telestration
 * canvas layered on top. Replay and audio render in the sidebar. */
export function VideoStage({
  stream,
  videoRef,
  clip,
  replaying,
  past,
  tool,
  color,
  width,
  onStrokeCommitted,
}: {
  stream: MediaStream | null
  /** The stage video element, shared with the replay controller in App. */
  videoRef: RefObject<HTMLVideoElement>
  /** The replay clip currently playing, or null for live video. */
  clip: ReplayClip | null
  /** Whether the stage is showing a replay (suppresses the empty state). */
  replaying: boolean
  /** Committed strokes owned by the host (App). */
  past: Stroke[]
  /** The active drawing tool. */
  tool: Tool
  /** The active stroke colour. */
  color: string
  /** The active stroke width. */
  width: number
  /** Called once per completed gesture with the gesture to commit. */
  onStrokeCommitted: (gesture: Gesture & { id: string }) => void
}) {
  const screenRef = useRef<HTMLDivElement>(null)
  const [scale, setScale] = useState(1)

  // Fit the logical frame into the stage area, preserving the 16:9 ratio. The
  // frame is laid out at its logical size and scaled, so it can never push the
  // sidebar or overflow the stage.
  useEffect(() => {
    const host = screenRef.current
    if (!host) return
    const measure = () => {
      const { width, height } = host.getBoundingClientRect()
      if (width <= 0 || height <= 0) return
      setScale(Math.min(width / STAGE_WIDTH, height / STAGE_HEIGHT))
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(host)
    return () => observer.disconnect()
  }, [])

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
  }, [stream, clip, videoRef])

  return (
    <div className="screen" data-testid="screen" ref={screenRef}>
      <div className="screen__media">
        <div
          className="screen__frame"
          data-testid="stage-frame"
          data-scale={scale.toFixed(4)}
          style={{ transform: `scale(${scale})` }}
        >
          <video ref={videoRef} className="screen__video" muted playsInline />
          {!stream && !replaying && <div className="screen__empty">No signal</div>}
          <TelestrationOverlay
            strokes={past}
            tool={tool}
            color={color}
            width={width}
            onStrokeCommitted={onStrokeCommitted}
          />
        </div>
      </div>
    </div>
  )
}
