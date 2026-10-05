import { useEffect, useState } from 'react'
import { formatClock } from '../lib/mediaFeeds'

/**
 * Transport for an opened file or stream.
 *
 * The stage has no controls of its own — the telestration canvas covers it — so
 * play, pause, scrub and restart live here, driving the hidden element the feed
 * plays in. A live stream has no duration to scrub; a finished file restarts
 * from the beginning.
 */
export function MediaTransport({ element }: { element: HTMLVideoElement }) {
  const [playing, setPlaying] = useState(!element.paused)
  const [ended, setEnded] = useState(element.ended)
  const [time, setTime] = useState(element.currentTime)
  const [duration, setDuration] = useState(element.duration)

  useEffect(() => {
    const syncTime = () => setTime(element.currentTime)
    const onPlay = () => {
      setPlaying(true)
      setEnded(false)
    }
    const onPause = () => setPlaying(false)
    const onEnded = () => {
      setPlaying(false)
      setEnded(true)
    }
    const onDuration = () => setDuration(element.duration)

    element.addEventListener('timeupdate', syncTime)
    element.addEventListener('play', onPlay)
    element.addEventListener('pause', onPause)
    element.addEventListener('ended', onEnded)
    element.addEventListener('durationchange', onDuration)
    return () => {
      element.removeEventListener('timeupdate', syncTime)
      element.removeEventListener('play', onPlay)
      element.removeEventListener('pause', onPause)
      element.removeEventListener('ended', onEnded)
      element.removeEventListener('durationchange', onDuration)
    }
  }, [element])

  const live = !Number.isFinite(duration) || duration === 0

  const play = () => {
    // A file that has run out starts again rather than sitting at the end.
    if (element.ended) element.currentTime = 0
    void element.play().catch(() => undefined)
  }

  const toggle = () => {
    if (element.paused) play()
    else element.pause()
  }

  return (
    <div
      className="transport"
      data-testid="media-transport"
      data-state={ended ? 'ended' : playing ? 'playing' : 'paused'}
    >
      <div className="row">
        <button type="button" className="chip" data-testid="media-play" onClick={toggle}>
          {playing ? '⏸ Pause' : ended ? '▶ Replay' : '▶ Play'}
        </button>
        <button
          type="button"
          className="chip"
          data-testid="media-restart"
          onClick={() => {
            element.currentTime = 0
            void element.play().catch(() => undefined)
          }}
        >
          ⏮ Restart
        </button>
        <span className="transport__time">
          {formatClock(time)}
          {live ? ' · live' : ` / ${formatClock(duration)}`}
        </span>
      </div>
      {!live && (
        <input
          type="range"
          className="transport__seek"
          data-testid="media-seek"
          aria-label="Seek"
          min={0}
          max={duration}
          step={0.1}
          value={Math.min(time, duration)}
          onChange={(event) => {
            element.currentTime = Number(event.target.value)
            setTime(element.currentTime)
          }}
        />
      )}
    </div>
  )
}
