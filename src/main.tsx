import { StrictMode, Suspense, lazy } from 'react'
import { createRoot } from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'
import App from './App'
import { CAMERA_PARAM } from './lib/cameraLink'
import './index.css'

// A `?camera=` link is the cameraman entry. It is code-split so a phone that
// only ever streams never downloads the host stage.
const CameramanApp = lazy(() => import('./cameraman/CameramanApp'))

const isCameraman = new URLSearchParams(window.location.search).has(CAMERA_PARAM)

if (import.meta.env.PROD) {
  registerSW({ immediate: true })
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {isCameraman ? (
      <Suspense fallback={<div className="screen__empty">Loading camera…</div>}>
        <CameramanApp />
      </Suspense>
    ) : (
      <App />
    )}
  </StrictMode>,
)
