import { describe, expect, it } from 'vitest'
import { mergeStageSources, type StageFeed } from './sources'

function fakeStream(id: string): MediaStream {
  return { id } as unknown as MediaStream
}

function feed(id: string, label: string): StageFeed {
  return { id, label, stream: fakeStream(`${id}-stream`) }
}

describe('mergeStageSources', () => {
  it('returns nothing while no input is live', () => {
    expect(mergeStageSources(null, [], [], [])).toEqual([])
  })

  it('lists the shared screen first with a stable id', () => {
    const screen = fakeStream('screen-stream')
    expect(mergeStageSources(screen, [], [], [])).toEqual([
      { id: 'screen', label: 'Shared screen', kind: 'screen', stream: screen },
    ])
  })

  it('keeps every host camera, in the order they were added', () => {
    const sources = mergeStageSources(null, [feed('cam:a', 'Camera A'), feed('cam:b', 'Camera B')], [], [])
    expect(sources.map((source) => source.id)).toEqual(['cam:a', 'cam:b'])
    expect(sources.every((source) => source.kind === 'camera')).toBe(true)
  })

  it('appends opened media, then cameraman feeds, after the host inputs', () => {
    const screen = fakeStream('s')
    const host = [feed('cam:a', 'Camera A')]
    const media = [feed('media:1', 'match.mp4')]
    const cameramen = [feed('camera:peer-1', 'Camera 1111')]

    const sources = mergeStageSources(screen, host, media, cameramen)

    expect(sources.map((source) => source.id)).toEqual([
      'screen',
      'cam:a',
      'media:1',
      'camera:peer-1',
    ])
    expect(sources.map((source) => source.kind)).toEqual(['screen', 'camera', 'media', 'camera'])
    expect(sources.every((source) => source.stream !== null)).toBe(true)
  })

  it('never reuses an id, even if a cameraman id looks like a built-in one', () => {
    const sources = mergeStageSources(
      fakeStream('s'),
      [feed('cam:webcam', 'Host camera')],
      [feed('media:webcam', 'Impostor file')],
      [feed('camera:cam:webcam', 'Impostor camera')],
    )
    expect(new Set(sources.map((source) => source.id)).size).toBe(sources.length)
  })
})
