import { useEffect, useRef } from 'react'
import type { AudioSource } from '../lib/audio'
import type { AudioController } from '../lib/useAudioMixer'

/** RMS is small for speech, so the meter amplifies before clamping to 0–1. */
const METER_GAIN = 4

/**
 * On-stage audio controls: one row per source with mute, volume, and a live
 * meter. The meters are written straight to the DOM from a rAF loop so a moving
 * level never re-renders the stage or the drawing canvas.
 */
export function AudioControls({
  micStatus,
  micNotice,
  gameAvailable,
  active,
  channels,
  enableMic,
  disableMic,
  setGain,
  toggleMute,
  level,
}: AudioController) {
  const micMeterRef = useRef<HTMLSpanElement>(null)
  const gameMeterRef = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    if (!active) return
    let frame = 0
    const tick = () => {
      const paint = (element: HTMLSpanElement | null, source: AudioSource) => {
        if (!element) return
        const value = Math.min(1, level(source) * METER_GAIN)
        element.style.transform = `scaleX(${value.toFixed(3)})`
      }
      paint(micMeterRef.current, 'mic')
      paint(gameMeterRef.current, 'game')
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [active, level])

  return (
    <div className="audio" data-testid="audio-controls" data-mic={micStatus}>
      <div className="audio__row">
        <span className="audio__label">🎙 Mic</span>
        {micStatus === 'on' ? (
          <>
            <button
              type="button"
              className={`chip chip--icon ${channels.mic.muted ? '' : 'chip--on'}`}
              data-testid="mic-mute"
              aria-pressed={channels.mic.muted}
              title={channels.mic.muted ? 'Unmute mic' : 'Mute mic'}
              onClick={() => toggleMute('mic')}
            >
              {channels.mic.muted ? '🔇' : '🔊'}
            </button>
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={channels.mic.volume}
              data-testid="mic-gain"
              aria-label="Mic volume"
              onChange={(event) => setGain('mic', Number(event.target.value))}
            />
            <span className="audio__meter" data-testid="mic-meter">
              <span ref={micMeterRef} className="audio__meterFill" />
            </span>
            <button type="button" className="chip" data-testid="mic-disable" onClick={disableMic}>
              Off
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              className="chip"
              data-testid="mic-enable"
              disabled={micStatus === 'requesting'}
              onClick={() => void enableMic()}
            >
              {micStatus === 'requesting' ? 'Requesting…' : 'Enable'}
            </button>
            {micNotice && (
              <span
                className={`audio__notice ${micStatus === 'denied' ? 'audio__notice--denied' : ''}`}
                data-testid="mic-notice"
                role="alert"
              >
                {micNotice}
              </span>
            )}
          </>
        )}
      </div>

      <div className="audio__row">
        <span className="audio__label">🎮 Game</span>
        {gameAvailable ? (
          <>
            <button
              type="button"
              className={`chip chip--icon ${channels.game.muted ? '' : 'chip--on'}`}
              data-testid="game-mute"
              aria-pressed={channels.game.muted}
              title={channels.game.muted ? 'Unmute game audio' : 'Mute game audio'}
              onClick={() => toggleMute('game')}
            >
              {channels.game.muted ? '🔇' : '🔊'}
            </button>
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={channels.game.volume}
              data-testid="game-gain"
              aria-label="Game volume"
              onChange={(event) => setGain('game', Number(event.target.value))}
            />
            <span className="audio__meter" data-testid="game-meter">
              <span ref={gameMeterRef} className="audio__meterFill" />
            </span>
          </>
        ) : (
          <span className="audio__notice" data-testid="game-none">
            no captured audio
          </span>
        )}
      </div>
    </div>
  )
}
