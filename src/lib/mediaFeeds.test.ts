import { describe, expect, it } from 'vitest'
import {
  MEDIA_ERR_ABORTED,
  MEDIA_ERR_DECODE,
  MEDIA_ERR_NETWORK,
  MEDIA_ERR_SRC_NOT_SUPPORTED,
  feedLabel,
  fileNameLabel,
  formatClock,
  isHlsUrl,
  isPlayableUrl,
  isUnsupportedStream,
  mediaErrorMessage,
} from './mediaFeeds'

describe('isHlsUrl', () => {
  it('spots playlists whatever the query string', () => {
    expect(isHlsUrl('https://cdn.example.com/live/index.m3u8')).toBe(true)
    expect(isHlsUrl('https://cdn.example.com/live/index.M3U8?token=abc')).toBe(true)
  })

  it('leaves progressive files alone', () => {
    expect(isHlsUrl('https://cdn.example.com/match.mp4')).toBe(false)
    expect(isHlsUrl('not a url')).toBe(false)
  })
})

describe('isPlayableUrl / isUnsupportedStream', () => {
  it('accepts what the browser can be handed', () => {
    expect(isPlayableUrl('https://cdn.example.com/match.mp4')).toBe(true)
    expect(isPlayableUrl('blob:http://localhost:5173/1234')).toBe(true)
  })

  it('refuses schemes that never work in a page, and says so separately', () => {
    expect(isPlayableUrl('rtsp://camera.example.com/stream')).toBe(false)
    expect(isUnsupportedStream('rtsp://camera.example.com/stream')).toBe(true)
    expect(isUnsupportedStream('rtmp://live.example.com/app')).toBe(true)
    expect(isUnsupportedStream('https://cdn.example.com/match.mp4')).toBe(false)
    expect(isPlayableUrl('not a url')).toBe(false)
  })
})

describe('labels', () => {
  it('labels a URL by its host', () => {
    expect(feedLabel('https://www.example.com/live/index.m3u8')).toBe('example.com')
    expect(feedLabel('not a url')).toBe('Stream')
  })

  it('labels a file by its name without the extension', () => {
    expect(fileNameLabel('Sunday league final.mp4')).toBe('Sunday league final')
    expect(fileNameLabel('/tmp/clip.webm')).toBe('clip')
    expect(fileNameLabel('.mp4')).toBe('Video file')
  })
})

describe('formatClock', () => {
  it('reads as minutes and seconds, padding the seconds', () => {
    expect(formatClock(0)).toBe('0:00')
    expect(formatClock(7)).toBe('0:07')
    expect(formatClock(65)).toBe('1:05')
    expect(formatClock(599)).toBe('9:59')
  })

  it('grows an hours span only when there are hours', () => {
    expect(formatClock(3600)).toBe('1:00:00')
    expect(formatClock(3725)).toBe('1:02:05')
  })

  it('never prints nonsense for a live or unreadable duration', () => {
    expect(formatClock(Number.POSITIVE_INFINITY)).toBe('0:00')
    expect(formatClock(Number.NaN)).toBe('0:00')
    expect(formatClock(-4)).toBe('0:00')
  })
})

describe('mediaErrorMessage', () => {
  it('explains each of the browser error codes', () => {
    expect(mediaErrorMessage(MEDIA_ERR_ABORTED)).toContain('stopped')
    expect(mediaErrorMessage(MEDIA_ERR_NETWORK)).toContain('CORS')
    expect(mediaErrorMessage(MEDIA_ERR_DECODE)).toContain('codec')
    expect(mediaErrorMessage(MEDIA_ERR_SRC_NOT_SUPPORTED)).toContain('format')
    expect(mediaErrorMessage(undefined)).toContain('could not be opened')
  })
})
