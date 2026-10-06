/**
 * Using a web page as an input: what we can tell about its video, and what the
 * studio should do about it.
 *
 * The studio cannot read another document's element, so the picture has to arrive
 * from inside the page — a script we inject calls `captureStream()` on its
 * `<video>` and hands the track over. Whether that is allowed is decided by the
 * browser, per *media resource*, and the answers are not guessable from the URL:
 *
 * - An **MSE** page (YouTube, Twitch) plays a `blob:` URL it built itself, so the
 *   resource is the page's own and `captureStream()` works. Measured on a live
 *   YouTube stream: one unmuted video track, frames carrying real picture.
 * - A **progressive file on another origin** is refused outright — Chromium
 *   throws `SecurityError` and drawing it into a canvas taints that canvas.
 *   Measured with a file served from a second port.
 * - **EME** content is protected whatever else is true of it, so its frames are
 *   withheld from capture by design.
 *
 * So the deciding facts are collected in the page and judged here. Keeping the
 * judgement pure means the reasons an operator sees can be tested rather than
 * discovered by staring at a black stage.
 */

/** How a page feeds the video its `<video>` element is playing. */
export type PageVideoSource =
  /** MSE: the page supplied the fragments, so the element plays its own `blob:`. */
  | 'mse'
  /** A `MediaStream` assigned directly to the element. */
  | 'stream'
  /** A plain file or stream on the page's own origin. */
  | 'same-origin'
  /** A plain file or stream on another origin. */
  | 'cross-origin'
  /** No source yet: there is a player, but nothing loaded into it. */
  | 'none'

/** What an injected script can report about the page's video. */
export interface PageVideoFacts {
  /** Whether the page has a `<video>` element at all. */
  hasVideo: boolean
  source: PageVideoSource
  /** Whether the element has `mediaKeys` set, i.e. EME is in play. */
  protected: boolean
  /**
   * Whether one frame could actually be read back in the page — draw the element
   * into a 1×1 canvas and call `getImageData`. This is the authoritative answer,
   * and it is deliberately the fact the verdict leans on rather than the URL.
   */
  readable: boolean
}

export type PageVideoVerdict =
  | { kind: 'ready' }
  | { kind: 'refused'; notice: string }

/** A page with a player but nothing playing is a "start it, then ask" case. */
const NO_VIDEO = 'This page has no video playing yet. Start the video, then try again.'

/**
 * DRM is the one refusal that cannot be worked around, so it says so plainly
 * rather than suggesting a route that will also fail.
 */
const PROTECTED =
  'This page plays protected video, which the browser will not let anything read — not even to draw on it. There is no way round that; share the tab instead.'

/** The unreadable case worth naming, because there *is* another way in. */
const CROSS_ORIGIN =
  'This page plays its video straight from another site, which the browser will not let us read. Share the tab instead.'

const UNREADABLE = 'The browser will not let this page’s video be read. Share the tab instead.'

/**
 * Decide whether a page's video can become an input.
 *
 * Order matters: a page can be both protected and readable-looking, and DRM is
 * the more specific reason, so it is reported first.
 */
export function judgePageVideo(facts: PageVideoFacts): PageVideoVerdict {
  if (!facts.hasVideo || facts.source === 'none') return { kind: 'refused', notice: NO_VIDEO }
  if (facts.protected) return { kind: 'refused', notice: PROTECTED }
  if (!facts.readable) {
    return {
      kind: 'refused',
      notice: facts.source === 'cross-origin' ? CROSS_ORIGIN : UNREADABLE,
    }
  }
  return { kind: 'ready' }
}

/**
 * Classify how the element is being fed, from its own state.
 *
 * This is the *diagnostic* half — it explains a refusal, rather than deciding
 * one, because a cross-origin source with `crossorigin` and honest CORS headers
 * is perfectly readable and no URL can tell us whether those headers are there.
 * `readable` in `PageVideoFacts` is the fact that decides.
 */
export function describePageVideo(input: {
  src: string
  hasStream: boolean
  pageOrigin: string
}): PageVideoSource {
  // A MediaStream assigned directly, which is how some players hand over a feed.
  if (input.hasStream) return 'stream'
  const src = input.src.trim()
  if (!src) return 'none'
  // MSE is the case that makes the big platforms work: the element plays a blob
  // the page owns, so its resource is the page's own origin.
  if (src.startsWith('blob:')) return 'mse'
  try {
    // Relative URLs resolve against the page, which is what the browser does.
    return new URL(src, input.pageOrigin).origin === input.pageOrigin
      ? 'same-origin'
      : 'cross-origin'
  } catch {
    // An unparseable address is not one we can claim to understand.
    return 'none'
  }
}
