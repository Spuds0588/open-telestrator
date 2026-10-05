import { StrictMode, Suspense, lazy } from 'react'
import { createRoot } from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'
import App from './App'
import { CAMERA_PARAM } from './lib/cameraLink'
import { WATCH_PARAM } from './lib/broadcast'
import './index.css'

// A `?camera=` link is the cameraman entry and `?watch=` the viewer entry.
// Both are code-split so a phone that only ever streams or watches never
// downloads the host stage.
const CameramanApp = lazy(() => import('./cameraman/CameramanApp'))
const ViewerApp = lazy(() => import('./viewer/ViewerApp'))

const params = new URLSearchParams(window.location.search)
const isCameraman = params.has(CAMERA_PARAM)
const isViewer = params.has(WATCH_PARAM)

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
