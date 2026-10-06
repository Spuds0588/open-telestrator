/**
 * Encoding the program, in the webview, for the shell to push.
 *
 * A browser has no RTMP socket but it does have hardware H.264, so the split is:
 * this file turns the program into encoded frames, and Rust takes them from
 * there. What crosses between the two is compressed — a few hundred kilobytes a
 * second — which is why it can be an ordinary IPC call rather than something
 * exotic.
 *
 * The picture comes from the element that is already showing the program, not
 * from a second compositor: `useProgramCompositor` draws the video, the corners
 * and the strokes into one stream, the stage shows it, and this samples that.
 * So what goes out is exactly what viewers see, including the drawing.
 *
 * Audio is the awkward corner. A browser can always encode Opus and RTMP wants
 * AAC, so when only Opus is on offer this deliberately sends no audio at all and
 * says so, rather than producing a stream a platform quietly drops.
 */

import { FRAME_KIND, encodeFrame } from './frameHeader'
import {
  AUDIO_CODECS,
  audioPlan,
  encoderBitrate,
  isKeyframeFrame,
  pickAudioCodec,
  pickVideoCodec,
  videoCodecCandidates,
  type AudioCodec,
} from './encoder'
import { streamFrame } from './desktop'

/** How many samples the audio tap hands over at a time. */
const AUDIO_CHUNK = 4096

export interface ProgramEncoderOptions {
  /** The element already showing the composited program. */
  source: HTMLVideoElement
  /** The stage mix, whose audio is encoded alongside the picture. */
  audio: MediaStream | null
  width: number
  height: number
  frameRate: number
  /** The stream has died for a reason worth showing. */
  onError: (reason: string) => void
  /** Something the operator should know but that is not fatal. */
  onWarning: (message: string) => void
}

export interface ProgramEncoder {
  /** Stop encoding. Idempotent, so an unmount racing a failure is safe. */
  close: () => void
}

/** A `Uint8Array` view of whatever shape a `BufferSource` arrives as. */
function bytesOf(description: AllowSharedBufferSource): Uint8Array {
  if (description instanceof ArrayBuffer) return new Uint8Array(description)
  const view = description as ArrayBufferView
  return new Uint8Array(view.buffer, view.byteOffset, view.byteLength)
}

export async function startProgramEncoder(options: ProgramEncoderOptions): Promise<ProgramEncoder> {
  const { source, audio, width, height, frameRate, onError, onWarning } = options
  const bitrate = encoderBitrate(width, height, frameRate)

  // --- video ---------------------------------------------------------------
  const candidates = videoCodecCandidates(width, height, frameRate)
  const supported = new Map<string, boolean>()
  for (const codec of candidates) {
    let ok = false
    try {
      const result = await VideoEncoder.isConfigSupported({
        codec,
        width,
        height,
        bitrate,
        framerate: frameRate,
      })
      ok = result.supported === true
    } catch {
      ok = false
    }
    supported.set(codec, ok)
  }
  const videoCodec = pickVideoCodec(candidates, (codec) => supported.get(codec) === true)
  if (!videoCodec) {
    throw new Error('This machine cannot encode H.264, which every RTMP platform needs.')
  }

  let closed = false
  let videoSequenceSent = false
  let audioSequenceSent = false

  const video = new VideoEncoder({
    output: (chunk, metadata) => {
      // The decoder configuration arrives with the first chunk and has to reach
      // the platform before any frame: it is the SPS and PPS, and a decoder
      // cannot start without them.
      const description = metadata?.decoderConfig?.description
      if (description && !videoSequenceSent) {
        videoSequenceSent = true
        void streamFrame(
          encodeFrame({
            kind: FRAME_KIND.videoSequence,
            timestampUs: 0,
            keyframe: false,
            compositionTime: 0,
            payload: bytesOf(description),
          }),
        )
      }
      const payload = new Uint8Array(chunk.byteLength)
      chunk.copyTo(payload)
      void streamFrame(
        encodeFrame({
          kind: FRAME_KIND.video,
          timestampUs: chunk.timestamp,
          keyframe: chunk.type === 'key',
          // We ask for no B-frames, so presentation and decode order agree and
          // there is nothing to declare. A platform still requires the field.
          compositionTime: 0,
          payload,
        }),
      )
    },
    error: (error) => {
      if (closed) return
      onError(`The video encoder stopped: ${error.message}`)
    },
  })

  video.configure({
    codec: videoCodec,
    width,
    height,
    bitrate,
    framerate: frameRate,
    // Realtime, not quality: a telestrator is live, and a frame that arrives
    // late is worth less than a frame that is slightly rougher.
    latencyMode: 'realtime',
    // AVCC rather than Annex-B: length-prefixed NAL units are exactly what an
    // FLV video tag carries, so nothing has to be rewritten on the way through.
    avc: { format: 'avc' },
  })

  // --- audio ---------------------------------------------------------------
  // Support has to be asked for asynchronously, so it is resolved into a map
  // first and the (tested) picker then works from that.
  const audioSupported = new Map<AudioCodec, boolean>()
  for (const codec of AUDIO_CODECS) {
    let ok = false
    try {
      const result = await AudioEncoder.isConfigSupported({
        codec,
        sampleRate: 48_000,
        numberOfChannels: 2,
        bitrate: 128_000,
      })
      ok = result.supported === true
    } catch {
      ok = false
    }
    audioSupported.set(codec, ok)
  }
  const audioCodec = pickAudioCodec((codec) => audioSupported.get(codec) === true)
  const plan = audioPlan(audioCodec)
  if (plan.warning) onWarning(plan.warning)

  let context: AudioContext | null = null
  let tap: ScriptProcessorNode | null = null
  let audioEncoder: AudioEncoder | null = null
  let silent: GainNode | null = null

  if (plan.encode && audio && audioCodec) {
    try {
      context = new AudioContext({ sampleRate: 48_000 })
      const sourceNode = context.createMediaStreamSource(audio)
      audioEncoder = new AudioEncoder({
        output: (chunk, metadata) => {
          const description = metadata?.decoderConfig?.description
          if (description && !audioSequenceSent) {
            audioSequenceSent = true
            void streamFrame(
              encodeFrame({
                kind: FRAME_KIND.audioSequence,
                timestampUs: 0,
                keyframe: false,
                compositionTime: 0,
                payload: bytesOf(description),
              }),
            )
          }
          const payload = new Uint8Array(chunk.byteLength)
          chunk.copyTo(payload)
          void streamFrame(
            encodeFrame({
              kind: FRAME_KIND.audio,
              timestampUs: chunk.timestamp,
              keyframe: false,
              compositionTime: 0,
              payload,
            }),
          )
        },
        error: (error) => {
          if (closed) return
          onWarning(`The audio encoder stopped, so the stream is now silent: ${error.message}`)
        },
      })
      audioEncoder.configure({
        codec: audioCodec,
        sampleRate: context.sampleRate,
        numberOfChannels: 2,
        bitrate: 128_000,
      })

      // A ScriptProcessor rather than an AudioWorklet: it is deprecated but it
      // works in every webview, and the alternative needs a module loaded over
      // a URL before encoding can start. The node only ever feeds the encoder.
      tap = context.createScriptProcessor(AUDIO_CHUNK, 2, 2)
      tap.onaudioprocess = (event) => {
        if (closed || !audioEncoder || !context) return
        const input = event.inputBuffer
        const frames = input.length
        const channels = input.numberOfChannels
        // Planar, which is the layout `AudioData` wants for f32.
        const data = new Float32Array(frames * channels)
        for (let channel = 0; channel < channels; channel += 1) {
          data.set(input.getChannelData(channel), channel * frames)
        }
        const audioData = new AudioData({
          format: 'f32-planar',
          sampleRate: context.sampleRate,
          numberOfFrames: frames,
          numberOfChannels: channels,
          // The context's own clock, in microseconds, so audio and video share
          // an origin for the timestamps Rust rebases.
          timestamp: Math.round(event.playbackTime * 1_000_000),
          data,
        })
        audioEncoder.encode(audioData)
        audioData.close()
      }

      sourceNode.connect(tap)
      // A muted sink: the processor only runs while it is connected to the
      // destination, and connecting it at full gain would play the mix a second
      // time, over the top of itself.
      silent = context.createGain()
      silent.gain.value = 0
      tap.connect(silent)
      silent.connect(context.destination)
      await context.resume()
    } catch (error) {
      void error
      onWarning('The audio could not be captured, so the stream is video only.')
      audioEncoder = null
    }
  }

  // --- the frame loop ------------------------------------------------------
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const painter = canvas.getContext('2d', { alpha: false })
  if (!painter) {
    video.close()
    throw new Error('This machine cannot give the telestrator a drawing surface to encode.')
  }

  const started = performance.now()
  const interval = 1000 / Math.max(1, frameRate)
  let last = -Infinity
  let index = 0
  let frameHandle = 0

  const tick = (now: number) => {
    if (closed) return
    frameHandle = requestAnimationFrame(tick)
    // Hold to the target rate rather than the display's: a 144 Hz screen must
    // not triple the stream's bitrate.
    if (now - last < interval - 1) return
    last = now
    if (source.readyState < 2) return
    painter.drawImage(source, 0, 0, width, height)
    const frame = new VideoFrame(canvas, { timestamp: Math.round((now - started) * 1000) })
    video.encode(frame, { keyFrame: isKeyframeFrame(index, frameRate) })
    frame.close()
    index += 1
  }
  frameHandle = requestAnimationFrame(tick)

  return {
    close: () => {
      if (closed) return
      closed = true
      cancelAnimationFrame(frameHandle)
      if (tap) {
        tap.onaudioprocess = null
        tap.disconnect()
      }
      silent?.disconnect()
      try {
        audioEncoder?.close()
      } catch {
        // Already closed by an error callback; nothing to do.
      }
      try {
        video.close()
      } catch {
        // Likewise.
      }
      void context?.close()
    },
  }
}
