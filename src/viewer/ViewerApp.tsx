import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  Cast,
  Maximize,
  Minimize,
  Pause,
  PictureInPicture2,
  Play,
  Volume1,
  Volume2,
  VolumeX,
} from 'lucide-react'
import Peer, { type DataConnection, type MediaConnection } from 'peerjs'
import {
  HEARTBEAT_MS,
  MAX_REJOIN_ATTEMPTS,
  STALL_TICKS,
  parseBroadcastMessage,
  parseViewerLink,
  wantsEmbed,
  type ViewerSession,
} from '../lib/broadcast'
import {
  PAUSE_BUFFER_LIMIT_MS,
  backlogFinished,
  bufferLimitReached,
  castState,
  clampVolume,
  formatClock,
  pickPipMode,
  pickRecorderMime,
  stepVolume,
  volumeLevel,
  type CastState,
} from '../lib/player'
import { peerOptions } from '../lib/peerConfig'

type ViewerStatus = 'ready' | 'connecting' | 'live' | 'ended' | 'full' | 'error'

/** The Remote Playback API, described structurally so older TS libs still build. */
interface RemotePlaybackLike {
  state: 'disconnected' | 'connecting' | 'connected'
  prompt: () => Promise<void>
  addEventListener: (type: string, listener: () => void) => void
  removeEventListener: (type: string, listener: () => void) => void
}

/** The Document Picture-in-Picture API, described structurally so older TS libs still build. */
interface DocumentPipLike {
  requestWindow: (options?: { width?: number; height?: number }) => Promise<Window>
}

/** The browser's floating-window API, where it has one. */
function getDocumentPip(): DocumentPipLike | null {
  return (window as Window & { documentPictureInPicture?: DocumentPipLike }).documentPictureInPicture ?? null
}

/** Video picture-in-picture, as the browser reports it. */
function hasVideoPip(): boolean {
  return 'pictureInPictureEnabled' in document && document.pictureInPictureEnabled === true
}

/**
 * Give the floating window the app's own styles, so the stage looks the same
 * there. Same-origin sheets are read rule by rule; anything else is linked by
 * URL.
 */
function copyPlayerStyles(target: Document): void {
  target.documentElement.style.height = '100%'
  target.body.style.cssText = 'margin:0;height:100%;background:#000;overflow:hidden'
  const base = target.createElement('base')
  base.href = document.baseURI
  target.head.append(base)
  for (const sheet of Array.from(document.styleSheets)) {
    try {
      const css = Array.from(sheet.cssRules)
        .map((rule) => rule.cssText)
        .join('\n')
      const style = target.createElement('style')
      style.textContent = css
      target.head.append(style)
    } catch {
      const link = target.createElement('link')
      link.rel = 'stylesheet'
      if (sheet.href) link.href = sheet.href
      target.head.append(link)
    }
  }
}

/** How long the controls stay up after the last interaction, while playing. */
const CONTROLS_IDLE_MS = 2600

/**
 * The viewer page.
 *
 * It joins the host's tree over a data channel, gets a parent, receives that
 * parent's live stream and — in turn — calls any viewer the host places under
 * it. Playback is live-only: no seeking, no catch-up, no synchronisation with
 * other viewers.
 *
 * Because a parent can vanish at any moment (its tab closed, its network dropped,
 * its own parent gone), every viewer watches its own picture: if frames stop, or
 * the transport to its parent dies, it drops its children and rejoins the tree
 * through the host, which is what keeps one failure from freezing a whole branch.
 *
 * The controls are the familiar online-video ones. Pausing keeps a local recording
 * of what arrives while you are away (up to a cap) and plays it back when you
 * resume; with no recording available, resuming simply rejoins the live edge.
 */
export default function ViewerApp() {
  const [session] = useState<ViewerSession | null>(() => parseViewerLink(window.location.href))
  /**
   * A viewer link goes straight to work, so the page starts connecting — there
   * is no Watch button to press. A link missing its token has nowhere to
   * connect to, and simply says so.
   */
  const [status, setStatus] = useState<ViewerStatus>(() => (session ? 'connecting' : 'ready'))
  const [notice, setNotice] = useState<string | null>(null)
  /**
   * True when this page is somebody else's embed: the link says so outright,
   * or the page works it out from where it is running — inside a frame, or
   * linked from another origin.
   */
  const [embed] = useState(() =>
    wantsEmbed({
      href: window.location.href,
      framed: window.self !== window.top,
      referrer: document.referrer,
    }),
  )
  const [stream, setStream] = useState<MediaStream | null>(null)
  const [parentId, setParentId] = useState<string | null>(null)
  const [children, setChildren] = useState(0)
  const [peerId, setPeerId] = useState<string | null>(null)

  // ── Player state ─────────────────────────────────────────────────────────
  const [playing, setPlaying] = useState(false)
  const [muted, setMuted] = useState(true)
  const [volume, setVolume] = useState(1)
  const [controlsShown, setControlsShown] = useState(true)
  const [bufferedMs, setBufferedMs] = useState(0)
  const [fromPause, setFromPause] = useState(false)
  const [fullscreen, setFullscreen] = useState(false)
  const [pipActive, setPipActive] = useState(false)
  /** The floating window the stage has moved into, if there is one. */
  const [docPip, setDocPip] = useState<Window | null>(null)
  /** The stage's container, once React has handed it over. */
  const [mount, setMount] = useState<HTMLDivElement | null>(null)
  const [cast, setCast] = useState<CastState>('unsupported')

  const videoRef = useRef<HTMLVideoElement>(null)
  const playerRef = useRef<HTMLDivElement>(null)
  /** The container that holds the portalled stage; document PiP moves it. */
  const mountRef = useRef<HTMLDivElement | null>(null)
  /** The floating window, while the stage is in it. */
  const docPipRef = useRef<Window | null>(null)
  /** Where the container was in this page, so it can be put back. */
  const mountHomeRef = useRef<{ parent: Element; next: Node | null } | null>(null)
  const peerRef = useRef<Peer | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const hostConnRef = useRef<DataConnection | null>(null)
  const upstreamRef = useRef<MediaConnection | null>(null)
  const childCallsRef = useRef(new Map<string, MediaConnection>())
  const retryTimerRef = useRef<number | null>(null)
  const heartbeatRef = useRef<number | null>(null)
  const joinHostRef = useRef<(() => void) | null>(null)
  const attemptsRef = useRef(0)

  // ── Pause buffer refs ────────────────────────────────────────────────────
  const recorderRef = useRef<MediaRecorder | null>(null)
  const recorderTypeRef = useRef<string>('video/webm')
  const chunksRef = useRef<Blob[]>([])
  const blobUrlRef = useRef<string | null>(null)
  const backlogRef = useRef(false)
  const pauseStartedRef = useRef<number | null>(null)
  const recorderStartedAtRef = useRef<number | null>(null)
  /** Wall-clock length of the recording, in ms: the buffer's real duration. */
  const recordedMsRef = useRef(0)
  const castRef = useRef<RemotePlaybackLike | null>(null)

  const clearTimers = useCallback(() => {
    if (retryTimerRef.current !== null) {
      window.clearTimeout(retryTimerRef.current)
      retryTimerRef.current = null
    }
    if (heartbeatRef.current !== null) {
      window.clearInterval(heartbeatRef.current)
      heartbeatRef.current = null
    }
  }, [])

  /** Forget any buffered pause recording and its object URL. */
  const dropBuffer = useCallback(() => {
    if (blobUrlRef.current) {
      URL.revokeObjectURL(blobUrlRef.current)
      blobUrlRef.current = null
    }
    chunksRef.current = []
    pauseStartedRef.current = null
    setBufferedMs(0)
  }, [])

  /** React hands us the portal's container; keep it in reach for document PiP. */
  const attachMount = useCallback((node: HTMLDivElement | null) => {
    mountRef.current = node
    setMount(node)
  }, [])

  const teardown = useCallback(() => {
    clearTimers()
    for (const child of childCallsRef.current.values()) child.close()
    childCallsRef.current.clear()
    upstreamRef.current?.close()
    upstreamRef.current = null
    hostConnRef.current?.close()
    hostConnRef.current = null
    peerRef.current?.destroy()
    peerRef.current = null
    streamRef.current = null
    attemptsRef.current = 0
    dropBuffer()
    setStream(null)
    setParentId(null)
    setChildren(0)
    setPeerId(null)
    setPlaying(false)
    setFromPause(false)
    backlogRef.current = false
  }, [clearTimers, dropBuffer])

  useEffect(() => () => teardown(), [teardown])

  // Bind the live stream to the video element — but never while a buffered
  // replay owns it, or the picture would jump back to live mid-playback.
  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    if (backlogRef.current) return
    if (video.srcObject === stream) return
    video.srcObject = stream
    if (stream) void video.play().catch(() => undefined)
    // `mount` matters because the stage itself appears a beat after the first
    // render, once React has handed over its container.
  }, [stream, mount])

  // Volume and mute live on the element; the slider is the source of truth.
  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    video.volume = clampVolume(volume)
    video.muted = muted
  }, [volume, muted, mount])

  // Safari only offers AirPlay when the element opts in.
  useEffect(() => {
    videoRef.current?.setAttribute('x-webkit-airplay', 'allow')
  }, [])

  useEffect(() => {
    const onChange = () => setFullscreen(!!document.fullscreenElement)
    document.addEventListener('fullscreenchange', onChange)
    return () => document.removeEventListener('fullscreenchange', onChange)
  }, [])

  // Remote playback (cast) is only offered by some browsers; watch its state so
  // the button can show where the picture is actually going.
  useEffect(() => {
    const video = videoRef.current as (HTMLVideoElement & { remote?: RemotePlaybackLike }) | null
    const remote = video?.remote
    if (!video || !remote) return
    castRef.current = remote
    const sync = () => setCast(castState(true, remote.state))
    sync()
    remote.addEventListener('connect', sync)
    remote.addEventListener('connecting', sync)
    remote.addEventListener('disconnect', sync)
    return () => {
      remote.removeEventListener('connect', sync)
      remote.removeEventListener('connecting', sync)
      remote.removeEventListener('disconnect', sync)
    }
  }, [])

  useEffect(() => {
    const onChange = () => setPipActive(document.pictureInPictureElement === videoRef.current)
    document.addEventListener('enterpictureinpicture', onChange)
    document.addEventListener('leavepictureinpicture', onChange)
    return () => {
      document.removeEventListener('enterpictureinpicture', onChange)
      document.removeEventListener('leavepictureinpicture', onChange)
    }
  }, [])

  const idleTimerRef = useRef<number | null>(null)

  /** Show the controls and start the countdown that hides them again. */
  const pokeControls = useCallback(() => {
    setControlsShown(true)
    if (idleTimerRef.current !== null) window.clearTimeout(idleTimerRef.current)
    idleTimerRef.current = window.setTimeout(() => setControlsShown(false), CONTROLS_IDLE_MS)
  }, [])

  useEffect(() => {
    pokeControls()
    return () => {
      if (idleTimerRef.current !== null) window.clearTimeout(idleTimerRef.current)
    }
  }, [pokeControls])

  // Controls get out of the way once the picture is moving.
  useEffect(() => {
    if (playing) pokeControls()
  }, [playing, pokeControls])

  // ── Pause buffer ─────────────────────────────────────────────────────────

  /** Record what arrives while the viewer is paused, so resuming can replay it. */
  const startRecorder = useCallback(() => {
    const live = streamRef.current
    if (!live || typeof MediaRecorder === 'undefined' || recorderRef.current) return
    const mime = pickRecorderMime((type) => MediaRecorder.isTypeSupported(type))
    if (!mime) return
    try {
      const recorder = new MediaRecorder(live, { mimeType: mime })
      chunksRef.current = []
      recorderStartedAtRef.current = Date.now()
      recordedMsRef.current = 0
      recorderTypeRef.current = recorder.mimeType || mime
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data)
      }
      recorder.start(1000)
      recorderRef.current = recorder
    } catch {
      // A browser that cannot record simply has no pause buffer: resuming will
      // return to the live edge instead.
      recorderRef.current = null
    }
  }, [])

  /** Stop recording, keeping the chunks so they can still be replayed. */
  const stopRecorder = useCallback((): Promise<void> => {
    const recorder = recorderRef.current
    recorderRef.current = null
    const startedAt = recorderStartedAtRef.current
    recorderStartedAtRef.current = null
    if (startedAt !== null) recordedMsRef.current = Date.now() - startedAt
    if (!recorder || recorder.state === 'inactive') return Promise.resolve()
    return new Promise((resolve) => {
      recorder.onstop = () => resolve()
      try {
        recorder.stop()
      } catch {
        resolve()
      }
    })
  }, [])

  const pausePlayback = useCallback(() => {
    const video = videoRef.current
    if (!video) return
    video.pause()
    // Only the live picture is worth recording; a buffered replay pauses like
    // any ordinary video.
    if (!backlogRef.current && pauseStartedRef.current === null) {
      pauseStartedRef.current = Date.now()
      setBufferedMs(0)
      startRecorder()
    }
  }, [startRecorder])

  const backToLive = useCallback(() => {
    const video = videoRef.current
    backlogRef.current = false
    setFromPause(false)
    dropBuffer()
    if (!video) return
    video.removeAttribute('src')
    video.load()
    video.srcObject = streamRef.current
    video.volume = clampVolume(volumeRef.current)
    video.muted = mutedRef.current
    if (streamRef.current) void video.play().catch(() => undefined)
  }, [dropBuffer])

  /** Resume: replay the buffered pause if we kept one, otherwise rejoin live. */
  const resumePlayback = useCallback(async () => {
    const video = videoRef.current
    if (!video) return
    await stopRecorder()
    const chunks = chunksRef.current
    chunksRef.current = []
    pauseStartedRef.current = null
    setBufferedMs(0)

    if (chunks.length > 0) {
      const url = URL.createObjectURL(new Blob(chunks, { type: recorderTypeRef.current }))
      blobUrlRef.current = url
      backlogRef.current = true
      setFromPause(true)
      video.srcObject = null
      video.src = url
      video.volume = clampVolume(volumeRef.current)
      video.muted = mutedRef.current
      void video.play().catch(() => undefined)
      return
    }

    if (!streamRef.current) return
    video.srcObject = streamRef.current
    void video.play().catch(() => undefined)
  }, [stopRecorder])

  const volumeRef = useRef(volume)
  const mutedRef = useRef(muted)
  useEffect(() => {
    volumeRef.current = volume
    mutedRef.current = muted
  }, [volume, muted])

  const togglePlay = useCallback(() => {
    const video = videoRef.current
    if (!video) return
    if (video.paused) void resumePlayback()
    else pausePlayback()
  }, [pausePlayback, resumePlayback])

  const toggleMute = useCallback(() => {
    const next = !mutedRef.current
    // Unmuting an element that was left silent should be audible.
    if (!next && volumeRef.current === 0) setVolume(1)
    setMuted(next)
  }, [])

  const changeVolume = useCallback((next: number) => {
    const value = clampVolume(next)
    setVolume(value)
    setMuted(value === 0)
  }, [])

  // ── Picture in picture ─────────────────────────────────────────────────

  /**
   * Put the stage back where it belongs. Document PiP moves the portal
   * container — and with it the mounted player, controls and all — into the
   * floating window; this is the reverse trip, taken when that window closes.
   */
  const restoreFromPip = useCallback(() => {
    const home = mountHomeRef.current
    const node = mountRef.current
    mountHomeRef.current = null
    if (home && node && home.parent.isConnected) home.parent.insertBefore(node, home.next)
    setDocPip(null)
  }, [])

  /**
   * Open the stage in a document picture-in-picture window: a floating player
   * that keeps its controls and stays on top of whatever else is on screen.
   */
  const openDocumentPip = useCallback(async () => {
    const api = getDocumentPip()
    const node = mountRef.current
    const parent = node?.parentElement
    if (!api || !node || !parent || docPipRef.current) return
    let pipWindow: Window
    try {
      pipWindow = await api.requestWindow({ width: 640, height: 360 })
    } catch {
      // A framed page is not allowed a floating window; video picture-in-picture
      // is the fallback that still works there.
      try {
        await videoRef.current?.requestPictureInPicture()
        return
      } catch {
        setNotice('This browser would not open the floating player.')
        return
      }
    }
    copyPlayerStyles(pipWindow.document)
    mountHomeRef.current = { parent, next: node.nextSibling }
    pipWindow.document.body.append(node)
    docPipRef.current = pipWindow
    pipWindow.addEventListener('pagehide', () => {
      docPipRef.current = null
      restoreFromPip()
    })
    setDocPip(pipWindow)
  }, [restoreFromPip])

  const closeDocumentPip = useCallback(() => {
    const pipWindow = docPipRef.current
    if (!pipWindow) return
    docPipRef.current = null
    restoreFromPip()
    pipWindow.close()
  }, [restoreFromPip])

  // Unmounting the page must not leave a floating window holding the player, nor
  // React removing a child that has moved to another document.
  useLayoutEffect(
    () => () => {
      const pipWindow = docPipRef.current
      if (!pipWindow) return
      docPipRef.current = null
      restoreFromPip()
      pipWindow.close()
    },
    [restoreFromPip],
  )

  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement) {
      void document.exitFullscreen().catch(() => undefined)
      return
    }
    // While floating, the stage is the thing on screen; full screen takes it.
    const target = docPipRef.current ? mountRef.current : playerRef.current
    void target?.requestFullscreen().catch(() => undefined)
  }, [])

  const togglePip = useCallback(() => {
    if (docPipRef.current) {
      closeDocumentPip()
      return
    }
    if (document.pictureInPictureElement) {
      void document.exitPictureInPicture().catch(() => undefined)
      return
    }
    if (getDocumentPip()) {
      void openDocumentPip()
      return
    }
    void videoRef.current?.requestPictureInPicture().catch(() => undefined)
  }, [closeDocumentPip, openDocumentPip])

  const startCast = useCallback(() => {
    castRef.current?.prompt().catch(() => {
      setNotice('No device was available to cast to.')
    })
  }, [])

  // While paused, count the buffer up and stop it growing at the cap.
  useEffect(() => {
    if (playing || fromPause) return
    const timer = window.setInterval(() => {
      const startedAt = pauseStartedRef.current
      if (startedAt === null) return
      const elapsed = Date.now() - startedAt
      setBufferedMs(Math.min(elapsed, PAUSE_BUFFER_LIMIT_MS))
      if (bufferLimitReached(elapsed)) void stopRecorder()
    }, 1000)
    return () => window.clearInterval(timer)
  }, [playing, fromPause, stopRecorder])

  // The buffered replay ends by itself: hand back to the live edge the moment
  // it has played everything that was recorded, whether or not `ended` arrives.
  useEffect(() => {
    if (!fromPause) return
    const timer = window.setInterval(() => {
      const video = videoRef.current
      if (!video) return
      if (backlogFinished(video.currentTime * 1000, recordedMsRef.current)) backToLive()
    }, 500)
    return () => window.clearInterval(timer)
  }, [fromPause, backToLive])

  // Familiar keyboard shortcuts, wherever the player has focus.
  const onKeyDown = useCallback(
    (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return
      switch (event.key) {
        case ' ':
        case 'k':
        case 'K':
          event.preventDefault()
          togglePlay()
          pokeControls()
          break
        case 'm':
        case 'M':
          toggleMute()
          pokeControls()
          break
        case 'f':
        case 'F':
          toggleFullscreen()
          break
        case 'ArrowUp':
          event.preventDefault()
          changeVolume(stepVolume(volumeRef.current, 0.1))
          pokeControls()
          break
        case 'ArrowDown':
          event.preventDefault()
          changeVolume(stepVolume(volumeRef.current, -0.1))
          pokeControls()
          break
        default:
          break
      }
    },
    [changeVolume, pokeControls, toggleFullscreen, toggleMute, togglePlay],
  )

  useEffect(() => {
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onKeyDown])

  // With the stage floating in its own window, that window has the focus, so the
  // shortcuts have to be listened for there too.
  useEffect(() => {
    if (!docPip) return
    docPip.addEventListener('keydown', onKeyDown)
    return () => docPip.removeEventListener('keydown', onKeyDown)
  }, [docPip, onKeyDown])

  // React's pointer handlers live on this page, so the floating window needs its
  // own nudge to keep the controls awake.
  useEffect(() => {
    if (!docPip) return
    const wake = () => pokeControls()
    docPip.addEventListener('pointermove', wake)
    docPip.addEventListener('pointerdown', wake)
    return () => {
      docPip.removeEventListener('pointermove', wake)
      docPip.removeEventListener('pointerdown', wake)
    }
  }, [docPip, pokeControls])

  // ── Tree plumbing ────────────────────────────────────────────────────────

  const rejoin = useCallback(() => {
    const peer = peerRef.current
    if (!peer) return

    for (const child of childCallsRef.current.values()) child.close()
    childCallsRef.current.clear()
    setChildren(0)

    upstreamRef.current?.close()
    upstreamRef.current = null
    streamRef.current = null
    setStream(null)

    // Detach before closing so the close handler sees itself as superseded and
    // does not report the broadcast as ended on the way out.
    const hostConn = hostConnRef.current
    hostConnRef.current = null
    hostConn?.close()

    attemptsRef.current += 1
    if (attemptsRef.current > MAX_REJOIN_ATTEMPTS) {
      clearTimers()
      setStatus('ended')
      setNotice('Lost the broadcast. Ask the host for a fresh link.')
      return
    }

    setStatus('connecting')
    setNotice('Reconnecting…')
    // Back off a little, so a host that is itself restarting is not hammered.
    const delay = Math.min(4000, 400 * 2 ** (attemptsRef.current - 1))
    retryTimerRef.current = window.setTimeout(() => {
      retryTimerRef.current = null
      joinHostRef.current?.()
    }, delay)
  }, [clearTimers])

  const connect = useCallback(() => {
    if (!session || peerRef.current) return
    setStatus('connecting')
    setNotice(null)

    const peer = new Peer(peerOptions())
    peerRef.current = peer

    const report = () => {
      const hostConn = hostConnRef.current
      if (hostConn?.open) hostConn.send({ t: 'relay', children: childCallsRef.current.size })
    }

    const joinHost = () => {
      if (peerRef.current !== peer) return
      const conn = peer.connect(session.hostId, { reliable: true })
      hostConnRef.current = conn
      conn.on('open', () => {
        conn.send({ t: 'join', token: session.token })
        // The heartbeat keeps the host's view of the tree fresh and tells it we
        // are still alive, even while we have no children of our own.
        if (heartbeatRef.current === null) {
          heartbeatRef.current = window.setInterval(report, HEARTBEAT_MS)
        }
      })
      conn.on('data', (raw) => {
        const message = parseBroadcastMessage(raw)
        if (!message) return
        if (message.t === 'full') {
          setStatus('full')
          setNotice('The broadcast is full right now — try again in a moment.')
          return
        }
        if (message.t !== 'parent') return
        setParentId(message.parentId)
        if (message.parentId === session.hostId) {
          conn.send({ t: 'feed', token: session.token })
          return
        }
        const upstream = peer.connect(message.parentId, { reliable: true })
        upstream.on('open', () => upstream.send({ t: 'feed', token: session.token }))
      })
      conn.on('close', () => {
        if (hostConnRef.current !== conn) return
        hostConnRef.current = null
        if (streamRef.current) return
        clearTimers()
        setStatus('ended')
        setNotice('The broadcast ended. Ask the host for a fresh link.')
      })
    }
    joinHostRef.current = joinHost

    peer.on('open', (id) => {
      setPeerId(id)
      joinHost()
    })

    peer.on('error', (error) => {
      // The host peer is gone: the broadcast is over, not broken. Any other
      // error is a genuine failure to reach the broker.
      if (error.type === 'peer-unavailable') {
        clearTimers()
        setStatus('ended')
        setNotice('The broadcast ended. Ask the host for a fresh link.')
        return
      }
      setStatus('error')
      setNotice(`Could not join the broadcast (${error.type}).`)
    })

    // Our parent calls us with the live stream: answer without sending anything
    // back, then relay whatever arrives.
    peer.on('call', (call) => {
      call.answer()
      upstreamRef.current?.close()
      upstreamRef.current = call
      call.on('stream', (remote) => {
        streamRef.current = remote
        setStream(remote)
        setStatus('live')
        setNotice(null)
        // Note: the attempt counter is only reset once frames actually decode.
        // A parent that delivers a track but no picture must not be allowed to
        // reset it, or a frozen source loops through reconnects forever.
        report()
      })
      call.on('close', () => {
        if (upstreamRef.current === call) upstreamRef.current = null
        if (peerRef.current === peer && streamRef.current) {
          setNotice('Your feed stopped — finding a new source…')
          rejoin()
        } else if (peerRef.current === peer) {
          // A parent that never delivered: ask the host to place us elsewhere.
          rejoin()
        }
      })
    })

    // Downstream viewers ask us for the stream over a data channel; we call
    // them with the stream we are relaying, which is what makes this a tree.
    peer.on('connection', (conn) => {
      conn.on('data', (raw) => {
        const message = parseBroadcastMessage(raw)
        if (!message || message.t !== 'feed' || message.token !== session.token) return
        const media = streamRef.current
        if (!media) return
        const child = peer.call(conn.peer, media, { metadata: { token: session.token } })
        childCallsRef.current.set(conn.peer, child)
        setChildren(childCallsRef.current.size)
        report()
        child.on('close', () => {
          if (childCallsRef.current.get(conn.peer) !== child) return
          childCallsRef.current.delete(conn.peer)
          setChildren(childCallsRef.current.size)
          report()
        })
      })
      conn.on('close', () => {
        childCallsRef.current.get(conn.peer)?.close()
        childCallsRef.current.delete(conn.peer)
        setChildren(childCallsRef.current.size)
        report()
      })
    })
  }, [clearTimers, rejoin, session])

  /**
   * Watch our own picture. Two independent signals mean "my parent is gone":
   * the transport to it failing, and the decoder going quiet. Either one drops
   * this node — and its children — back into the tree through the host.
   */
  useEffect(() => {
    if (status !== 'live') return
    const video = videoRef.current
    if (!video) return

    const decodedFrames = (): number | null => {
      const withQuality = video as HTMLVideoElement & {
        getVideoPlaybackQuality?: () => { totalVideoFrames: number }
      }
      return withQuality.getVideoPlaybackQuality
        ? withQuality.getVideoPlaybackQuality().totalVideoFrames
        : null
    }

    let previous = decodedFrames()
    let stalled = 0
    const timer = window.setInterval(() => {
      // A paused viewer is not stalled on purpose: the buffer is filling.
      if (backlogRef.current || pauseStartedRef.current !== null) return
      const transport = upstreamRef.current?.peerConnection?.connectionState
      if (transport === 'failed' || transport === 'closed') {
        rejoin()
        return
      }
      const frames = decodedFrames()
      if (frames === null) return
      if (previous !== null && frames > previous) {
        // A moving picture is the only proof the path is healthy.
        stalled = 0
        attemptsRef.current = 0
        previous = frames
        return
      }
      previous = frames
      stalled += 1
      if (stalled >= STALL_TICKS) {
        stalled = 0
        rejoin()
      }
    }, 1000)

    return () => window.clearInterval(timer)
  }, [status, rejoin])

  const retry = useCallback(() => {
    teardown()
    setNotice(null)
    connect()
  }, [teardown, connect])

  // Joining is what a viewer page is for: it starts on its own rather than
  // waiting for someone to press Watch.
  useEffect(() => {
    if (session) connect()
  }, [connect, session])

  const statusText =
    status === 'ready'
      ? 'Waiting for a viewer link.'
      : status === 'connecting'
        ? 'Connecting to the broadcast…'
        : status === 'live'
          ? children > 0
            ? `Live — also relaying to ${children} viewer${children === 1 ? '' : 's'}.`
            : 'Live'
          : status === 'full'
            ? 'The broadcast is full.'
            : status === 'ended'
              ? 'The broadcast ended.'
              : 'Something went wrong.'

  const missingLink = session === null
  const showRetry = !missingLink && (status === 'ended' || status === 'full' || status === 'error')
  const live = status === 'live'
  const level = volumeLevel(volume, muted)
  const VolumeIcon = level === 'muted' ? VolumeX : level === 'low' ? Volume1 : Volume2
  const pipMode = pickPipMode(getDocumentPip() !== null, hasVideoPip())
  // An embedded player stays uncluttered: the status chip belongs to the viewer
  // page, and even there it is only noise once the picture is live.
  const showStatusChip = !missingLink && (!embed || status !== 'live')

  const onBigButton = () => {
    if (showRetry) retry()
    else togglePlay()
  }

  return (
    <div
      className={`player${embed ? ' player--embed' : ''}`}
      ref={playerRef}
      data-testid="viewer"
      data-status={status}
      data-parent={parentId ?? ''}
      data-children={children}
      data-peer={peerId ?? ''}
      data-playing={playing ? 'yes' : 'no'}
      data-mode={fromPause ? 'backlog' : 'live'}
      data-buffered={bufferedMs}
      data-volume={volume}
      data-muted={muted ? 'yes' : 'no'}
      data-cast={cast}
      data-embed={embed ? 'yes' : 'no'}
      data-pip={docPip ? 'document' : pipActive ? 'video' : 'off'}
      onPointerMove={pokeControls}
      onPointerDown={pokeControls}
      onPointerLeave={() => setControlsShown(false)}
    >
      {/* The stage is portalled into this container, which is what moves to the
          floating window — the player itself is never rebuilt. */}
      <div className="player__mount" ref={attachMount} />

      {/* The page behind a floating player, or the whole page for a bad link. */}
      <div className="player__center">
        {missingLink && (
          <p className="player__note">This viewer link is incomplete. Ask the host for a fresh one.</p>
        )}
        {docPip && (
          <div className="player__note">
            <span>Playing in the floating window.</span>
            <button type="button" className="btn" onClick={closeDocumentPip}>
              Bring it back
            </button>
          </div>
        )}
      </div>

      {mount &&
        createPortal(
          <div className={`player__stage${controlsShown || !playing ? ' player__stage--awake' : ''}`}>
            <video
              ref={videoRef}
              className="player__video"
              playsInline
              muted={muted}
              onClick={(event) => {
                // Clicking the picture is the oldest video habit there is.
                if ((event.target as HTMLElement).closest('.player__chrome')) return
                if (live || fromPause) togglePlay()
              }}
              onPlay={() => setPlaying(true)}
              onPause={() => setPlaying(false)}
              onEnded={() => {
                // The buffered replay ran out: rejoin the live edge.
                backToLive()
              }}
            />

            {/* Status and warnings sit away from the controls, like a stream overlay. */}
            <div className="player__chips">
              {showStatusChip && (
                <span className="player__chip" data-testid="viewer-status" data-state={status} role="status">
                  {statusText}
                </span>
              )}
              {notice && (
                <span className="player__chip player__chip--warn" role="alert">
                  {notice}
                </span>
              )}
              {cast === 'connected' && (
                <span className="player__chip player__chip--cast">
                  <Cast aria-hidden="true" />
                  Casting
                </span>
              )}
            </div>

            {!missingLink && !live && !fromPause && !showRetry && (
              <div className="player__center">
                <span className="player__spinner" aria-hidden="true" />
              </div>
            )}

            {showRetry && (
              <div className="player__center">
                <button type="button" className="btn" data-testid="viewer-retry" onClick={onBigButton}>
                  Try again
                </button>
              </div>
            )}

            <div className="player__chrome">
              {!showRetry && (
                <button
                  type="button"
                  className="player__big"
                  data-testid="viewer-play"
                  aria-label={playing ? 'Pause' : 'Play'}
                  onClick={onBigButton}
                >
                  {playing ? <Pause aria-hidden="true" /> : <Play aria-hidden="true" />}
                </button>
              )}

              <div className="player__bar">
                <button
                  type="button"
                  className="player__btn"
                  data-testid="viewer-play-small"
                  aria-label={playing ? 'Pause' : 'Play'}
                  onClick={() => (live || fromPause ? togglePlay() : onBigButton())}
                >
                  {playing ? <Pause aria-hidden="true" /> : <Play aria-hidden="true" />}
                </button>

                <button
                  type="button"
                  className="player__btn"
                  data-testid="viewer-audio"
                  aria-pressed={muted}
                  aria-label={muted ? 'Unmute' : 'Mute'}
                  onClick={toggleMute}
                >
                  <VolumeIcon aria-hidden="true" />
                </button>

                <input
                  className="player__volume"
                  data-testid="viewer-volume"
                  type="range"
                  min="0"
                  max="1"
                  step="0.05"
                  value={muted ? 0 : volume}
                  aria-label="Volume"
                  onChange={(event) => changeVolume(Number(event.target.value))}
                />

                <span className="player__live" data-testid="viewer-live" data-state={fromPause ? 'backlog' : playing ? 'live' : 'paused'}>
                  <span className="player__dot" aria-hidden="true" />
                  {fromPause
                    ? 'From your pause'
                    : playing
                      ? 'Live'
                      : pauseStartedRef.current !== null
                        ? `Paused · ${formatClock(bufferedMs)}`
                        : 'Paused'}
                </span>

                <span className="player__spacer" />

                {pipMode !== 'none' && (
                  <button
                    type="button"
                    className="player__btn"
                    data-testid="viewer-pip"
                    aria-pressed={pipActive || docPip !== null}
                    aria-label={docPip ? 'Close the floating player' : 'Picture in picture'}
                    onClick={togglePip}
                  >
                    <PictureInPicture2 aria-hidden="true" />
                  </button>
                )}

                {cast !== 'unsupported' && (
                  <button
                    type="button"
                    className="player__btn"
                    data-testid="viewer-cast"
                    aria-pressed={cast === 'connected'}
                    aria-label="Cast to a screen"
                    disabled={cast === 'connecting'}
                    onClick={startCast}
                  >
                    <Cast aria-hidden="true" />
                  </button>
                )}

                <button
                  type="button"
                  className="player__btn"
                  data-testid="viewer-fullscreen"
                  aria-label={fullscreen ? 'Exit full screen' : 'Full screen'}
                  onClick={toggleFullscreen}
                >
                  {fullscreen ? <Minimize aria-hidden="true" /> : <Maximize aria-hidden="true" />}
                  {fullscreen ? 'Exit' : ''}
                </button>
              </div>
            </div>
          </div>,
          mount,
        )}
    </div>
  )
}
