/**
 * Opened media: a local video file, or a URL to a stream.
 *
 * A feed plays in its own hidden `<video>` element and is exposed as a
 * MediaStream, so files and network streams are ordinary stage sources: the
 * buffer, the mixer and the compositor need to know nothing about where the
 * picture came from.
 *
 * What the browser can play is not what VLC can play: progressive files and
 * HLS work (HLS through `hls.js` where the browser has no native support),
 * while RTSP/RTMP — the other half of "open it in VLC" — are impossible in a
 * page and are refused with an honest notice.
 *
 * The pure bits live here so the classification can be unit-tested.
 */

/** Highest number of opened feeds the stage keeps at once, to bound resources. */
export const MAX_MEDIA_FEEDS = 4

/**
 * Opened media is re-drawn onto a canvas at this rate and the canvas is what
 * becomes the stage source. A media element's own `captureStream()` is a
 * one-shot: its track is removed for good the moment a file ends, while a
 * canvas track lives as long as the feed and keeps the last frame on screen.
 */
export const MEDIA_FEED_FPS = 30

/** Cap on the canvas a feed is drawn into, so a 4K file cannot eat the machine. */
export const MEDIA_FEED_MAX_WIDTH = 1280
export const MEDIA_FEED_MAX_HEIGHT = 720

/** HLS playlist URLs end this way, whatever the query string says. */
export function isHlsUrl(href: string): boolean {
  try {
    return new URL(href).pathname.toLowerCase().endsWith('.m3u8')
  } catch {
    return false
  }
}

/** The schemes the browser can be handed directly. */
export function isPlayableUrl(href: string): boolean {
  let url: URL
  try {
    url = new URL(href)
  } catch {
    return false
  }
  return url.protocol === 'http:' || url.protocol === 'https:' || url.protocol === 'blob:'
}

/** Protocols that never work in a browser, named so the notice can say why. */
export function isUnsupportedStream(href: string): boolean {
  try {
    const protocol = new URL(href).protocol
    return ['rtsp:', 'rtmp:', 'rtmps:', 'udp:', 'rtp:'].includes(protocol)
  } catch {
    return false
  }
}

/** A short, stable label for an opened URL: the host it comes from. */
export function feedLabel(href: string): string {
  try {
    const host = new URL(href).hostname.replace(/^www\./, '')
    return host || 'Stream'
  } catch {
    return 'Stream'
  }
}

/** A label for a picked file: its name without the extension. */
export function fileNameLabel(name: string): string {
  const trimmed = name.split(/[\\/]/).pop() ?? name
  const withoutExtension = trimmed.replace(/\.[a-z0-9]{1,5}$/i, '')
  return withoutExtension || 'Video file'
}

/**
 * `MediaError`'s codes, spelled out so this module needs no DOM globals (the
 * numbers are fixed by the HTML spec).
 */
/** `m:ss` for the transport's clock; hours appear only when needed. */
export function formatClock(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00'
  const total = Math.floor(seconds)
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const rest = total % 60
  const pad = (value: number) => String(value).padStart(2, '0')
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(rest)}` : `${minutes}:${pad(rest)}`
}

export const MEDIA_ERR_ABORTED = 1
export const MEDIA_ERR_NETWORK = 2
export const MEDIA_ERR_DECODE = 3
export const MEDIA_ERR_SRC_NOT_SUPPORTED = 4

/** The browser's own explanation for a media element's failure. */
export function mediaErrorMessage(code: number | undefined): string {
  switch (code) {
    case MEDIA_ERR_ABORTED:
      return 'Loading the video stopped before it was ready.'
    case MEDIA_ERR_NETWORK:
      return 'The video could not be fetched — check the link and whether the server allows this page (CORS).'
    case MEDIA_ERR_DECODE:
      return 'The video’s data is corrupt or uses a codec this browser cannot decode.'
    case MEDIA_ERR_SRC_NOT_SUPPORTED:
      return 'This file or stream is not a format the browser can play.'
    default:
      return 'The video could not be opened.'
  }
}
