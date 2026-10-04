import { useCallback, useEffect, useRef, useState } from 'react'
import {
  AudioMixer,
  classifyMicError,
  type AudioChannelState,
  type AudioSource,
  type MicStatus,
} from './audio'

export interface AudioController {
  micStatus: MicStatus
  micNotice: string | null
  /** Whether the current capture actually carries an audio track. */
  gameAvailable: boolean
  /** True while any source is producing sound (gates the meter loop). */
  active: boolean
  channels: Record<AudioSource, AudioChannelState>
  enableMic: () => Promise<void>
  disableMic: () => void
  setGain: (source: AudioSource, volume: number) => void
  toggleMute: (source: AudioSource) => void
  /** RMS level 0–1. Read imperatively from a rAF loop — never React state. */
  level: (source: AudioSource) => number
}

/**
 * Binds the audio graph to the capture stream.
 *
 * The graph lives and dies with the capture: losing (or stopping) capture tears
 * the whole thing down and releases the mic track. Volume/mute are the only
 * React state; metering is read imperatively so a moving meter never re-renders
 * the stage.
 */
export function useAudioMixer(stream: MediaStream | null): AudioController {
  const mixerRef = useRef<AudioMixer | null>(null)
  if (mixerRef.current === null) mixerRef.current = new AudioMixer()
  const mixer = mixerRef.current

  const [micStatus, setMicStatus] = useState<MicStatus>('idle')
  const [micNotice, setMicNotice] = useState<string | null>(null)
  const [gameAvailable, setGameAvailable] = useState(false)
  const [channels, setChannels] = useState<Record<AudioSource, AudioChannelState>>(() => ({
    mic: mixer.settingsFor('mic'),
    game: mixer.settingsFor('game'),
  }))

  const syncChannels = useCallback(() => {
    setChannels({ mic: mixer.settingsFor('mic'), game: mixer.settingsFor('game') })
  }, [mixer])

  useEffect(() => {
    setMicStatus('idle')
    setMicNotice(null)
    if (!stream) {
      mixer.stop()
      setGameAvailable(false)
      return
    }
    setGameAvailable(mixer.attachGame(stream))
    mixer.resume()
    return () => {
      mixer.stop()
    }
  }, [stream, mixer])

  const enableMic = useCallback(async () => {
    setMicStatus('requesting')
    setMicNotice(null)
    try {
      await mixer.enableMic()
      setMicStatus('on')
    } catch (cause) {
      const { status, notice } = classifyMicError(cause)
      setMicStatus(status)
      setMicNotice(notice)
    }
    syncChannels()
  }, [mixer, syncChannels])

  const disableMic = useCallback(() => {
    mixer.disableMic()
    setMicStatus('idle')
    setMicNotice(null)
    syncChannels()
  }, [mixer, syncChannels])

  const setGain = useCallback(
    (source: AudioSource, volume: number) => {
      mixer.setGain(source, volume)
      syncChannels()
    },
    [mixer, syncChannels],
  )

  const toggleMute = useCallback(
    (source: AudioSource) => {
      mixer.setMuted(source, !mixer.settingsFor(source).muted)
      syncChannels()
    },
    [mixer, syncChannels],
  )

  const level = useCallback((source: AudioSource) => mixer.readLevel(source), [mixer])

  return {
    micStatus,
    micNotice,
    gameAvailable,
    active: micStatus === 'on' || gameAvailable,
    channels,
    enableMic,
    disableMic,
    setGain,
    toggleMute,
    level,
  }
}
