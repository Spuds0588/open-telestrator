import { useCallback, useEffect, useRef, useState } from 'react'
import { classifyCameraError } from './mediaErrors'
import type { StageFeed } from './sources'

export interface CameraDevice {
  id: string
  label: string
}

export interface HostCameras {
  /** Every `videoinput` this machine reports. */
  devices: CameraDevice[]
  /** The cameras that are open right now, in the order they were added. */
  sources: StageFeed[]
  /** The device currently being opened, if any. */
  busy: string | null
  notice: string | null
  start: (deviceId: string) => Promise<void>
  stop: (deviceId: string) => void
}

/**
 * The host's own cameras.
 *
 * A desktop can have an array of cameras plugged into it — a work setup with
 * several USB feeds — so each `videoinput` is opened as its own capture and
 * appears as its own stage source, every one previewable and pickable as the
 * program. They are independent: stopping one leaves the others running.
 *
 * Device labels are hidden until the browser has been granted a camera once, so
 * the list is refreshed after every successful open and on `devicechange`.
 */
export function useHostCameras(): HostCameras {
  const [devices, setDevices] = useState<CameraDevice[]>([])
  const [sources, setSources] = useState<StageFeed[]>([])
  const [busy, setBusy] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const streamsRef = useRef(new Map<string, MediaStream>())
  const busyRef = useRef(false)
  const mountedRef = useRef(true)

  const refreshDevices = useCallback(async () => {
    const media = navigator.mediaDevices
    if (!media?.enumerateDevices) return
    try {
      const all = await media.enumerateDevices()
      const cameras = all
        .filter((device) => device.kind === 'videoinput')
        .map((device, index) => ({
          id: device.deviceId,
          label: device.label || `Camera ${index + 1}`,
        }))
      if (mountedRef.current) setDevices(cameras)
    } catch {
      // Enumeration is best-effort; the list simply stays as it was.
    }
  }, [])

  useEffect(() => {
    mountedRef.current = true
    void refreshDevices()
    const media = navigator.mediaDevices
    media?.addEventListener?.('devicechange', refreshDevices)
    return () => {
      mountedRef.current = false
      media?.removeEventListener?.('devicechange', refreshDevices)
      for (const stream of streamsRef.current.values()) {
        stream.getTracks().forEach((track) => track.stop())
      }
      streamsRef.current.clear()
    }
  }, [refreshDevices])

  const start = useCallback(
    async (deviceId: string) => {
      if (busyRef.current || streamsRef.current.has(deviceId)) return
      const media = navigator.mediaDevices
      if (!media?.getUserMedia) {
        setNotice('Camera capture isn’t available in this browser.')
        return
      }

      busyRef.current = true
      setBusy(deviceId)
      setNotice(null)
      try {
        // Audio stays off: the announcer mic is a separate input, so a camera
        // microphone never doubles into the mix.
        const stream = await media.getUserMedia({
          video: { deviceId: { exact: deviceId } },
          audio: false,
        })
        if (!mountedRef.current) {
          stream.getTracks().forEach((track) => track.stop())
          return
        }
        if (!stream.getVideoTracks()[0]) {
          stream.getTracks().forEach((track) => track.stop())
          setNotice('That camera didn’t provide a video track.')
          return
        }
        streamsRef.current.set(deviceId, stream)
        const label = devices.find((device) => device.id === deviceId)?.label ?? 'Camera'
        setSources((prev) => [...prev, { id: `cam:${deviceId}`, label, stream }])
        // The labels arrive with the first permission, so ask again now.
        void refreshDevices()
      } catch (cause) {
        if (mountedRef.current) setNotice(classifyCameraError(cause).notice)
      } finally {
        busyRef.current = false
        if (mountedRef.current) setBusy(null)
      }
    },
    [devices, refreshDevices],
  )

  const stop = useCallback((deviceId: string) => {
    const stream = streamsRef.current.get(deviceId)
    if (!stream) return
    streamsRef.current.delete(deviceId)
    stream.getTracks().forEach((track) => track.stop())
    setSources((prev) => prev.filter((source) => source.id !== `cam:${deviceId}`))
  }, [])

  return { devices, sources, busy, notice, start, stop }
}
