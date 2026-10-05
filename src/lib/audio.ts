/**
 * Stage audio mixing.
 *
 * One owner for the whole Web Audio graph. The announcer mic and the captured
 * game audio each feed their own GainNode (volume + mute) and their own
 * AnalyserNode (level metering), and both sum into the context destination.
 *
 * The stage `<video>` stays muted, so captured game audio is heard only through
 * this graph — a single playback path, no doubling. Audio is deliberately NOT
 * routed into the replay recorder; replay clips stay video-only.
 */

export type AudioSource = 'mic' | 'game'

export interface AudioChannelState {
  /** Remembered volume, 0–1, kept across mutes. */
  volume: number
  muted: boolean
}

export type MicStatus = 'idle' | 'requesting' | 'on' | 'denied' | 'error'

const DEFAULT_VOLUME = 0.8
const MIC_CONSTRAINTS: MediaStreamConstraints = { audio: true }

interface Channel {
  input: MediaStreamAudioSourceNode
  gain: GainNode
  analyser: AnalyserNode
  /** Reused buffer for `getFloatTimeDomainData`. */
  samples: Float32Array<ArrayBuffer>
}

/** Maps a `getUserMedia` rejection onto a deliberate mic state. */
export function classifyMicError(cause: unknown): {
  status: Extract<MicStatus, 'denied' | 'error'>
  notice: string
} {
  const name = cause instanceof DOMException ? cause.name : cause instanceof Error ? cause.name : ''
  const detail = cause instanceof Error ? cause.message : ''

  switch (name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return {
        status: 'denied',
        notice: 'Microphone access was blocked. Allow the mic for this site, then try again.',
      }
    case 'NotFoundError':
    case 'OverconstrainedError':
      return { status: 'error', notice: 'No microphone was found.' }
    case 'NotReadableError':
      return { status: 'error', notice: 'The microphone is in use by another application.' }
    case 'NotSupportedError':
      return { status: 'error', notice: 'This browser can’t capture microphone audio.' }
    default:
      return {
        status: 'error',
        notice: detail
          ? `Could not start the microphone (${name || 'unknown'}): ${detail}`
          : 'Could not start the microphone.',
      }
  }
}

export class AudioMixer {
  private context: AudioContext | null = null
  private master: GainNode | null = null
  private capture: MediaStreamAudioDestinationNode | null = null
  private micStream: MediaStream | null = null
  private readonly channels = new Map<AudioSource, Channel>()
  private readonly settings: Record<AudioSource, AudioChannelState> = {
    mic: { volume: DEFAULT_VOLUME, muted: false },
    game: { volume: DEFAULT_VOLUME, muted: false },
  }

  /** False when this browser has no Web Audio at all. */
  get supported(): boolean {
    return typeof AudioContext !== 'undefined'
  }

  get micActive(): boolean {
    return this.micStream !== null
  }

  get gameActive(): boolean {
    return this.channels.has('game')
  }

  /** Context state — `absent` before anything is attached, `closed` after stop. */
  get contextState(): AudioContextState | 'absent' {
    return this.context ? this.context.state : 'absent'
  }

  /** Current volume/mute for a source, whether or not it is attached. */
  settingsFor(source: AudioSource): AudioChannelState {
    return { ...this.settings[source] }
  }

  /** Best-effort resume; a no-op once the context is running. */
  resume(): void {
    const context = this.context
    if (context && context.state === 'suspended') void context.resume().catch(() => undefined)
  }

  /**
   * The stage mix as a MediaStream, for broadcasting to viewers. Safe to call
   * before anything is attached: the destination is created on demand and the
   * same stream is reused for the life of the graph.
   */
  captureStream(): MediaStream | null {
    const context = this.ensureContext()
    if (!context || !this.master) return null
    if (!this.capture) {
      this.capture = context.createMediaStreamDestination()
      this.master.connect(this.capture)
    }
    this.resume()
    return this.capture.stream
  }

  /** Detach the captured game audio, leaving the mic and context untouched. */
  detachGame(): void {
    this.detach('game')
  }

  /**
   * Route a captured stream's audio track through the graph. Returns false when
   * the capture has no audio track (or Web Audio is unavailable).
   */
  attachGame(stream: MediaStream): boolean {
    this.detach('game')
    const track = stream.getAudioTracks()[0]
    if (!track) return false
    const context = this.ensureContext()
    if (!context || !this.master) return false
    this.channels.set('game', this.createChannel(new MediaStream([track]), context, this.master))
    this.applyGain('game')
    this.resume()
    return true
  }

  /** Acquire the microphone and attach it. Throws the browser's rejection. */
  async enableMic(): Promise<void> {
    this.disableMic()
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new DOMException('getUserMedia is unavailable', 'NotSupportedError')
    }
    const stream = await navigator.mediaDevices.getUserMedia(MIC_CONSTRAINTS)
    const context = this.ensureContext()
    if (!context || !this.master) {
      stream.getTracks().forEach((track) => track.stop())
      throw new DOMException('Web Audio is unavailable', 'NotSupportedError')
    }
    this.micStream = stream
    this.channels.set('mic', this.createChannel(stream, context, this.master))
    this.applyGain('mic')
    this.resume()
  }

  /** Detach and release the microphone. */
  disableMic(): void {
    this.detach('mic')
    this.micStream?.getTracks().forEach((track) => track.stop())
    this.micStream = null
  }

  setGain(source: AudioSource, volume: number): void {
    this.settings[source].volume = Math.min(1, Math.max(0, volume))
    this.resume()
    this.applyGain(source)
  }

  setMuted(source: AudioSource, muted: boolean): void {
    this.settings[source].muted = muted
    this.resume()
    this.applyGain(source)
  }

  /** Root-mean-square level (0–1) of a source, measured after its gain node. */
  readLevel(source: AudioSource): number {
    const channel = this.channels.get(source)
    if (!channel || this.context?.state !== 'running') return 0
    channel.analyser.getFloatTimeDomainData(channel.samples)
    let sum = 0
    for (let i = 0; i < channel.samples.length; i += 1) {
      sum += channel.samples[i] * channel.samples[i]
    }
    return Math.sqrt(sum / channel.samples.length)
  }

  /** Tear the whole graph down, release the mic, and close the context. */
  stop(): void {
    this.disableMic()
    this.detach('game')
    this.master?.disconnect()
    this.master = null
    this.capture?.disconnect()
    this.capture = null
    const context = this.context
    this.context = null
    if (context && context.state !== 'closed') void context.close().catch(() => undefined)
  }

  private ensureContext(): AudioContext | null {
    if (this.context) return this.context
    if (!this.supported) return null
    const context = new AudioContext()
    const master = context.createGain()
    master.gain.value = 1
    master.connect(context.destination)
    this.context = context
    this.master = master
    this.resume()
    return context
  }

  private createChannel(stream: MediaStream, context: AudioContext, master: GainNode): Channel {
    const input = context.createMediaStreamSource(stream)
    const gain = context.createGain()
    const analyser = context.createAnalyser()
    analyser.fftSize = 1024
    input.connect(gain)
    // The analyser sits after the gain so muting also flattens the meter.
    gain.connect(analyser)
    gain.connect(master)
    const samples = new Float32Array(new ArrayBuffer(analyser.fftSize * Float32Array.BYTES_PER_ELEMENT))
    return { input, gain, analyser, samples }
  }

  private applyGain(source: AudioSource): void {
    const channel = this.channels.get(source)
    if (!channel) return
    const { volume, muted } = this.settings[source]
    channel.gain.gain.value = muted ? 0 : volume
  }

  private detach(source: AudioSource): void {
    const channel = this.channels.get(source)
    if (!channel) return
    channel.input.disconnect()
    channel.analyser.disconnect()
    channel.gain.disconnect()
    this.channels.delete(source)
  }
}
