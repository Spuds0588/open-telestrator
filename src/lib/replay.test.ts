import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ReplayBuffer } from './replay'

/**
 * A recording fake: `emit()` mirrors the browser firing `dataavailable` every
 * timeslice, and instances are tracked so a test can see a rotation.
 */
class FakeRecorder {
  static instances: FakeRecorder[] = []
  static isTypeSupported(): boolean {
    return true
  }

  state: 'inactive' | 'recording' = 'inactive'
  ondataavailable: ((event: { data: Blob }) => void) | null = null

  constructor(_stream: unknown, _options?: unknown) {
    FakeRecorder.instances.push(this)
  }

  start(): void {
    this.state = 'recording'
  }

  stop(): void {
    this.state = 'inactive'
  }

  emit(bytes: number): void {
    this.ondataavailable?.({ data: new Blob([new Uint8Array(bytes)]) })
  }
}

class FakeMediaStream {
  constructor(readonly tracks: unknown[]) {}
}

const videoTrack = { id: 'video', stop: () => undefined }
const stream = { getVideoTracks: () => [videoTrack] } as unknown as MediaStream

beforeEach(() => {
  FakeRecorder.instances = []
  vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] })
  vi.stubGlobal('MediaRecorder', FakeRecorder)
  vi.stubGlobal('MediaStream', FakeMediaStream)
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('ReplayBuffer', () => {
  it('reports support and starts one session for the video track', () => {
    const buffer = new ReplayBuffer()
    expect(buffer.supported).toBe(true)

    buffer.start(stream)

    expect(FakeRecorder.instances).toHaveLength(1)
    expect(FakeRecorder.instances[0].state).toBe('recording')
  })

  it('has no clip until the first chunk and the minimum window have elapsed', () => {
    const buffer = new ReplayBuffer({ minSeconds: 1, replaySeconds: 10 })
    buffer.start(stream)

    FakeRecorder.instances[0].emit(8)
    expect(buffer.getClip()).toBeNull()

    vi.advanceTimersByTime(1000)
    FakeRecorder.instances[0].emit(8)

    const clip = buffer.getClip()
    expect(clip).not.toBeNull()
    expect(clip!.seconds).toBeCloseTo(1)
    expect(clip!.startSeconds).toBe(0)
    expect(clip!.blob).toBeInstanceOf(Blob)
  })

  it('starts the replay point back from the end of the recorded window', () => {
    const buffer = new ReplayBuffer({ minSeconds: 1, replaySeconds: 10 })
    buffer.start(stream)

    vi.advanceTimersByTime(15_000)
    FakeRecorder.instances[0].emit(8)

    const clip = buffer.getClip()
    expect(clip!.seconds).toBeCloseTo(15)
    expect(clip!.startSeconds).toBeCloseTo(5)
  })

  it('rotates at the session limit and keeps the finished clip playable while the new session warms up', () => {
    const buffer = new ReplayBuffer({ windowSeconds: 30, minSeconds: 1, replaySeconds: 10 })
    buffer.start(stream)
    const first = FakeRecorder.instances[0]

    vi.advanceTimersByTime(31_000)
    first.emit(8) // crosses the 30s limit, so the session rotates

    expect(first.state).toBe('inactive')
    expect(FakeRecorder.instances).toHaveLength(2)
    expect(buffer.getClip()!.seconds).toBeCloseTo(31)

    // The fresh session wins as soon as it holds a full minimum window.
    const second = FakeRecorder.instances[1]
    vi.advanceTimersByTime(1_000)
    second.emit(4)
    expect(buffer.getClip()!.seconds).toBeCloseTo(1)
  })

  it('drops every clip on stop', () => {
    const buffer = new ReplayBuffer({ minSeconds: 1 })
    buffer.start(stream)
    vi.advanceTimersByTime(2_000)
    FakeRecorder.instances[0].emit(8)
    expect(buffer.getClip()).not.toBeNull()

    buffer.stop()

    expect(buffer.getClip()).toBeNull()
    expect(FakeRecorder.instances[0].state).toBe('inactive')
  })

  it('never opens a session without a video track', () => {
    const buffer = new ReplayBuffer()
    buffer.start({ getVideoTracks: () => [] } as unknown as MediaStream)
    expect(FakeRecorder.instances).toHaveLength(0)
    expect(buffer.getClip()).toBeNull()
  })
})
