import { describe, expect, it } from 'vitest'
import {
  describePageVideo,
  judgePageVideo,
  pickPageVideo,
  type PageVideoCandidate,
  type PageVideoFacts,
} from './webPageInput'

const facts = (over: Partial<PageVideoFacts> = {}): PageVideoFacts => ({
  hasVideo: true,
  source: 'mse',
  protected: false,
  readable: true,
  unreachableFrames: 0,
  ...over,
})

const video = (over: Partial<PageVideoCandidate> = {}): PageVideoCandidate => ({
  source: 'mse',
  hasFrame: true,
  width: 1280,
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

  it('says embedded, not empty, when the player is in another site’s frame', () => {
    // Measured: a page embedding a player shows an iframe and no `<video>` at
    // all, and telling the operator to start a video would send them nowhere.
    const verdict = judgePageVideo(facts({ hasVideo: false, source: 'none', unreachableFrames: 1 }))
    expect(verdict.kind).toBe('refused')
    if (verdict.kind === 'refused') {
      expect(verdict.notice).toMatch(/embeds its player/i)
      expect(verdict.notice).not.toMatch(/start the video/i)
    }
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

describe('pickPageVideo', () => {
  it('skips the cross-origin ad element to reach the live stream', () => {
    // Measured on Kick: the live MSE player and a `static.kick.com` ad MP4 on
    // the same page, the ad listed first here because order is the whole risk.
    expect(
      pickPageVideo([
        video({ source: 'cross-origin' }),
        video({ source: 'mse' }),
      ]),
    ).toBe(1)
  })

  it('skips Rumble’s empty placeholder as well as its ad', () => {
    // Measured on Rumble, in page order: ad, live stream, empty element.
    expect(
      pickPageVideo([
        video({ source: 'cross-origin' }),
        video({ source: 'mse', width: 1920 }),
        video({ source: 'none', hasFrame: false, width: 0 }),
      ]),
    ).toBe(1)
  })

  it('takes the only video there is', () => {
    expect(pickPageVideo([video()])).toBe(0)
    expect(pickPageVideo([video({ source: 'same-origin' })])).toBe(0)
    expect(pickPageVideo([video({ source: 'stream' })])).toBe(0)
  })

  it('returns a cross-origin element when it is all the page has, so the refusal can name it', () => {
    expect(pickPageVideo([video({ source: 'cross-origin' })])).toBe(0)
  })

  it('finds nothing when every element is empty — the zero-track case', () => {
    expect(pickPageVideo([video({ source: 'none', hasFrame: false, width: 0 })])).toBe(-1)
    expect(pickPageVideo([])).toBe(-1)
  })

  it('waits for a frame rather than choosing a source that has none yet', () => {
    // An element with a `blob:` assigned but nothing decoded cannot be captured
    // from, so a later element that does have a frame wins.
    expect(
      pickPageVideo([
        video({ source: 'mse', hasFrame: false, width: 0 }),
        video({ source: 'mse' }),
      ]),
    ).toBe(1)
  })
})
