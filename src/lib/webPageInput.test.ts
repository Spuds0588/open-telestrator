import { describe, expect, it } from 'vitest'
import { describePageVideo, judgePageVideo, type PageVideoFacts } from './webPageInput'

const facts = (over: Partial<PageVideoFacts> = {}): PageVideoFacts => ({
  hasVideo: true,
  source: 'mse',
  protected: false,
  readable: true,
  ...over,
})

describe('describePageVideo', () => {
  it('calls an MSE element a blob its page owns', () => {
    // Measured: this is what YouTube's live player looks like.
    expect(
      describePageVideo({
        src: 'blob:https://www.youtube.com/36e154ba-d8d5',
        hasStream: false,
        pageOrigin: 'https://www.youtube.com',
      }),
    ).toBe('mse')
  })

  it('prefers a directly assigned stream over any src', () => {
    expect(
      describePageVideo({
        src: 'https://cdn.example.com/ignored.mp4',
        hasStream: true,
        pageOrigin: 'https://cdn.example.com',
      }),
    ).toBe('stream')
  })

  it('reads a relative address as the page’s own origin', () => {
    expect(
      describePageVideo({ src: '/media/clip.mp4', hasStream: false, pageOrigin: 'https://example.com' }),
    ).toBe('same-origin')
  })

  it('separates another origin from the page’s own', () => {
    expect(
      describePageVideo({
        src: 'https://cdn.example.net/clip.mp4',
        hasStream: false,
        pageOrigin: 'https://example.com',
      }),
    ).toBe('cross-origin')
  })

  it('reports nothing playing, and nothing it cannot parse', () => {
    expect(describePageVideo({ src: '   ', hasStream: false, pageOrigin: 'https://example.com' })).toBe('none')
    expect(describePageVideo({ src: 'not a url', hasStream: false, pageOrigin: 'not an origin' })).toBe('none')
  })
})

describe('judgePageVideo', () => {
  it('accepts a readable MSE page — the measured YouTube case', () => {
    expect(judgePageVideo(facts())).toEqual({ kind: 'ready' })
  })

  it('accepts a readable file on the page’s own origin', () => {
    expect(judgePageVideo(facts({ source: 'same-origin' }))).toEqual({ kind: 'ready' })
  })

  it('asks for the video to be started when there is nothing playing', () => {
    const verdict = judgePageVideo(facts({ source: 'none' }))
    expect(verdict.kind).toBe('refused')
    if (verdict.kind === 'refused') expect(verdict.notice).toMatch(/start the video/i)
  })

  it('refuses a page with no video element at all', () => {
    expect(judgePageVideo(facts({ hasVideo: false })).kind).toBe('refused')
  })

  it('refuses an unreadable cross-origin page and points at sharing the tab', () => {
    // Measured: drawing it into a canvas throws SecurityError.
    const verdict = judgePageVideo(facts({ source: 'cross-origin', readable: false }))
    expect(verdict.kind).toBe('refused')
    if (verdict.kind === 'refused') {
      expect(verdict.notice).toMatch(/another site/i)
      expect(verdict.notice).toMatch(/share the tab/i)
    }
  })

  it('reports DRM ahead of anything else it could say', () => {
    const verdict = judgePageVideo(facts({ protected: true, readable: false, source: 'cross-origin' }))
    expect(verdict.kind).toBe('refused')
    if (verdict.kind === 'refused') expect(verdict.notice).toMatch(/protected video/i)
  })

  it('does not promise a way round DRM', () => {
    const verdict = judgePageVideo(facts({ protected: true }))
    expect(verdict.kind).toBe('refused')
    if (verdict.kind === 'refused') expect(verdict.notice).toMatch(/no way round/i)
  })

  it('falls back to a plain reason when unreadable for any other cause', () => {
    const verdict = judgePageVideo(facts({ source: 'stream', readable: false }))
    expect(verdict.kind).toBe('refused')
    if (verdict.kind === 'refused') expect(verdict.notice).not.toMatch(/another site/i)
  })
})
