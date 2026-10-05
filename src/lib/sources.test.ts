import { describe, expect, it } from 'vitest'
import { mergeStageSources, type CameraFeed } from './sources'

function fakeStream(id: string): MediaStream {
  return { id } as unknown as MediaStream
}

describe('mergeStageSources', () => {
  it('returns nothing while no input is live', () => {
    expect(mergeStageSources(null, null, [])).toEqual([])
  })

  it('lists the shared screen first with a stable id', () => {
    const screen = fakeStream('screen-stream')
    const sources = mergeStageSources(screen, null, [])
    expect(sources).toEqual([
      { id: 'screen', label: 'Shared screen', kind: 'screen', stream: screen },
    ])
  })

  it('adds the host webcam as a camera source', () => {
    const webcam = fakeStream('webcam-stream')
    expect(mergeStageSources(null, webcam, [])).toEqual([
      { id: 'webcam', label: 'Webcam', kind: 'camera', stream: webcam },
    ])
  })

  it('appends cameraman feeds after the screen and webcam', () => {
    const screen = fakeStream('s')
    const webcam = fakeStream('w')
    const feeds: CameraFeed[] = [
      { id: 'peer-1', label: 'Camera 1111', stream: fakeStream('c1') },
      { id: 'peer-2', label: 'Camera 2222', stream: fakeStream('c2') },
    ]

    const sources = mergeStageSources(screen, webcam, feeds)

    expect(sources.map((source) => source.id)).toEqual([
      'screen',
      'webcam',
      'camera:peer-1',
      'camera:peer-2',
    ])
    expect(sources.map((source) => source.kind)).toEqual([
      'screen',
      'camera',
      'camera',
      'camera',
    ])
    expect(sources.every((source) => source.stream !== null)).toBe(true)
  })

  it('never reuses an id, even if a cameraman id looks like a built-in one', () => {
    const sources = mergeStageSources(fakeStream('s'), fakeStream('w'), [
      { id: 'webcam', label: 'Impostor', stream: fakeStream('c') },
    ])
    expect(new Set(sources.map((source) => source.id)).size).toBe(sources.length)
  })
})
