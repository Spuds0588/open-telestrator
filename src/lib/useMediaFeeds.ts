import { useCallback, useEffect, useRef, useState } from 'react'
import type Hls from 'hls.js'
import type { ErrorData } from 'hls.js'
import { startFrameLoop } from './frameLoop'
import {
  MAX_MEDIA_FEEDS,
  MEDIA_FEED_FPS,
  MEDIA_FEED_MAX_HEIGHT,
  MEDIA_FEED_MAX_WIDTH,
  feedLabel,
  fileNameLabel,
  isHlsUrl,
  isPlayableUrl,
  isUnsupportedStream,
  mediaErrorMessage,
} from './mediaFeeds'
import type { StageFeed } from './sources'

/** A feed the host opened: a picked file, or a link to a stream. */
export interface MediaFeed extends StageFeed {
  /** The element it plays in; the mixer takes this feed's audio from here. */
  element: HTMLVideoElement
}

export interface MediaFeeds {
  feeds: MediaFeed[]
  /** True while a feed is being opened, so the controls can say so. */
  busy: boolean
  notice: string | null
  openFile: (file: File) => void
  openUrl: (url: string) => void
  stop: (id: string) => void
}

interface Entry extends MediaFeed {
  hls: Hls | null
  objectUrl: string | null
  stopLoop: () => void
}

/**
 * Resolves when the element is showing data, rejects on the browser's error.
 * A stream that is already showing a picture resolves straight away — the
 * caller may start playback first (MSE needs that), so the event could
 * otherwise have fired before this is called and never come again.
 */
function whenLoaded(element: HTMLMediaElement): Promise<void> {
  if (element.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) return Promise.resolve()
  return new Promise((resolve, reject) => {
    const done = () => {
      cleanup()
      resolve()
    }
    const failed = () => {
      cleanup()
      reject(new Error(mediaErrorMessage(element.error?.code)))
    }
    const cleanup = () => {
      element.removeEventListener('loadeddata', done)
      element.removeEventListener('error', failed)
    }
    element.addEventListener('loadeddata', done)
    element.addEventListener('error', failed)
  })
}

function hlsFailure(data: ErrorData): string {
  const code = data.response?.code
  return code
    ? `The stream could not be loaded (HTTP ${code}). Check the link, and whether the server allows this page (CORS).`
    : 'The stream could not be loaded. Check the link, and whether the server allows this page (CORS).'
}

/**
 * Opened media: local video files and stream URLs, as ordinary stage sources.
 *
 * Each feed plays in its own hidden element, which is re-drawn onto a canvas
 * every frame — the canvas is the stage source. A media element's own
 * `captureStream()` cannot be used: its track is removed for good the moment a
 * file ends, and the picture would vanish; a canvas track stays live through
 * seeks and pauses, and leaves the last frame on screen when the media runs out.
 *
 * The canvas carries no audio, and that is deliberate: the mixer routes the
 * element's own audio through the game channel instead, which is what keeps a
 * feed that is merely sitting in the list silent.
 *
 * HLS goes through `hls.js` — imported only when a playlist is actually opened,
 * so browsers that never touch one never download it. RTSP and RTMP are refused
 * outright: no page can play them.
 */
export function useMediaFeeds(): MediaFeeds {
  const [feeds, setFeeds] = useState<MediaFeed[]>([])
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)

  const entriesRef = useRef(new Map<string, Entry>())
  const nextIdRef = useRef(1)
  const mountedRef = useRef(true)

  const release = useCallback((entry: Entry) => {
    entry.stopLoop()
    entry.hls?.destroy()
    entry.stream.getTracks().forEach((track) => track.stop())
    entry.element.pause()
    entry.element.removeAttribute('src')
    entry.element.load()
    if (entry.objectUrl) URL.revokeObjectURL(entry.objectUrl)
  }, [])

  const stop = useCallback(
    (id: string) => {
      const entry = entriesRef.current.get(id)
      if (!entry) return
      entriesRef.current.delete(id)
      release(entry)
      setFeeds((prev) => prev.filter((feed) => feed.id !== id))
    },
    [release],
  )

  useEffect(() => {
    // Set on every mount, not just from the initial value: React remounts an
    // effect once in development, and a flag that only ever goes false would
    // make every feed opened afterwards look unmounted and vanish silently.
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      for (const entry of entriesRef.current.values()) release(entry)
      entriesRef.current.clear()
    }
  }, [release])

  /**
   * Open one feed: hand the element to `load`, wait for a picture, then turn it
   * into a stage source. Every failure path releases whatever was created.
   */
  const open = useCallback(
    async (
      label: string,
      load: (element: HTMLVideoElement) => Promise<Hls | null>,
      objectUrl: string | null,
    ) => {
      if (entriesRef.current.size >= MAX_MEDIA_FEEDS) {
        if (objectUrl) URL.revokeObjectURL(objectUrl)
        setNotice(`The stage holds ${MAX_MEDIA_FEEDS} opened videos at once — stop one first.`)
        return
      }

      setBusy(true)
      setNotice(null)
      const element = document.createElement('video')
      element.playsInline = true
      // Muted until the feed becomes the program: autoplay is always allowed,
      // nothing leaks out of the speakers, and the mixer unmutes it on selection.
      element.muted = true

      let hls: Hls | null = null
      let stopLoop: (() => void) | null = null
      try {
        hls = await load(element)
        // Playback is requested before waiting for a picture: an MSE stream
        // (hls.js) only fills its buffer once the element is asked to play.
        await element.play().catch(() => undefined)
        await whenLoaded(element)

        const canvas = document.createElement('canvas')
        const ctx = canvas.getContext('2d')
        if (!ctx) throw new Error('This browser can’t use a video as a stage source.')

        // Size follows the source, capped, and is re-checked as it plays: a
        // stream can change resolution mid-flight.
        const fit = () => {
          const scale = Math.min(
            1,
            MEDIA_FEED_MAX_WIDTH / element.videoWidth,
            MEDIA_FEED_MAX_HEIGHT / element.videoHeight,
          )
          const width = Math.max(2, Math.round(element.videoWidth * scale))
          const height = Math.max(2, Math.round(element.videoHeight * scale))
          if (canvas.width !== width || canvas.height !== height) {
            canvas.width = width
            canvas.height = height
          }
        }
        if (element.videoWidth > 0) fit()

        const stream = canvas.captureStream(MEDIA_FEED_FPS)
        stopLoop = startFrameLoop(() => {
          if (element.readyState < HTMLMediaElement.HAVE_CURRENT_DATA || element.videoWidth === 0) {
            return
          }
          fit()
          ctx.drawImage(element, 0, 0, canvas.width, canvas.height)
        }, 1000)

        if (!mountedRef.current) {
          stopLoop()
          hls?.destroy()
          stream.getTracks().forEach((track) => track.stop())
          throw new Error('gone')
        }

        const id = `media:${nextIdRef.current}`
        nextIdRef.current += 1
        const entry: Entry = { id, label, stream, element, hls, objectUrl, stopLoop }
        entriesRef.current.set(id, entry)
        setFeeds((prev) => [...prev, { id, label, stream, element }])
      } catch (cause) {
        if (cause instanceof Error && cause.message === 'gone') return
        stopLoop?.()
        hls?.destroy()
        element.pause()
        element.removeAttribute('src')
        element.load()
        if (objectUrl) URL.revokeObjectURL(objectUrl)
        if (mountedRef.current) {
          setNotice(cause instanceof Error ? cause.message : 'The video could not be opened.')
        }
      } finally {
        if (mountedRef.current) setBusy(false)
      }
    },
    [],
  )

  const openUrl = useCallback(
    (raw: string) => {
      const url = raw.trim()
      if (isUnsupportedStream(url)) {
        setNotice(
          'RTSP and RTMP streams can’t play in a browser — use an HLS playlist (.m3u8) or a plain video URL.',
        )
        return
      }
      if (!isPlayableUrl(url)) {
        setNotice('Paste an http(s) link to a video file or HLS playlist.')
        return
      }

      void open(
        feedLabel(url),
        async (element) => {
          const nativeHls = element.canPlayType('application/vnd.apple.mpegurl') !== ''
          if (isHlsUrl(url) && !nativeHls) {
            const { default: Hls } = await import('hls.js')
            if (!Hls.isSupported()) throw new Error('This browser can’t play HLS streams.')
            const hls = new Hls({ enableWorker: true })
            const failed = new Promise<never>((_resolve, reject) => {
              hls.on(Hls.Events.ERROR, (_event, data) => {
                if (data.fatal) reject(new Error(hlsFailure(data)))
              })
            })
            hls.loadSource(url)
            hls.attachMedia(element)
            await Promise.race([whenLoaded(element), failed])
            return hls
          }
          // Cross-origin streams must be readable: the feed is drawn to a
          // canvas, so a stream without CORS headers fails up front rather than
          // tainting the picture later.
          element.crossOrigin = 'anonymous'
          element.src = url
          return null
        },
        null,
      )
    },
    [open],
  )

  const openFile = useCallback(
    (file: File) => {
      const objectUrl = URL.createObjectURL(file)
      void open(
        fileNameLabel(file.name),
        async (element) => {
          element.src = objectUrl
          return null
        },
        objectUrl,
      )
    },
    [open],
  )

  return { feeds, busy, notice, openFile, openUrl, stop }
}
