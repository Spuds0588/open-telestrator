import { StrictMode, Suspense, lazy } from 'react'
import { createRoot } from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'
import App from './App'
import { CAMERA_PARAM } from './lib/cameraLink'
import { WATCH_PARAM } from './lib/broadcast'
import './index.css'

// This bundle is the studio page (app.html). A `?camera=` link is the
// cameraman entry and `?watch=` the viewer entry; both are code-split so a
// phone that only ever streams or watches never downloads the host stage.
const CameramanApp = lazy(() => import('./cameraman/CameramanApp'))
const ViewerApp = lazy(() => import('./viewer/ViewerApp'))

const params = new URLSearchParams(window.location.search)
const isCameraman = params.has(CAMERA_PARAM)
const isViewer = params.has(WATCH_PARAM)

// The worker is registered in the built app only. In dev it would cache the
// studio under itself and serve that stale copy back on the next reload.
//
// `registerSW` does the updating too, when the build is an `autoUpdate` one: it
// reloads the page once a new worker activates, so an installed studio cannot be
// left running a bundle from months ago. That only works because the build asks
// for `skipWaiting` and `clientsClaim` (see `vite.config.ts`) — without them the
// new worker waits for an open page to close, which on a phone may be never.
if (import.meta.env.PROD) {
  registerSW({ immediate: true })
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {isViewer ? (
      <Suspense fallback={<div className="screen__empty">Loading broadcast…</div>}>
        <ViewerApp />
      </Suspense>
    ) : isCameraman ? (
      <Suspense fallback={<div className="screen__empty">Loading camera…</div>}>
        <CameramanApp />
      </Suspense>
    ) : (
      <App />
    )}
  </StrictMode>,
)
