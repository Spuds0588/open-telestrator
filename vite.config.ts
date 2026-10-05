import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// GitHub Pages serves a project site from https://<owner>.github.io/<repo>/,
// so the deploy workflow sets VITE_BASE_PATH. Local dev/build keep "/".
const base = process.env.VITE_BASE_PATH ?? '/'

// The landing page keeps the bare base address, so it is the one navigation the
// offline fallback must not swallow — it is precached by filename instead.
const escapedBase = base.replace(/\/$/, '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const homeUrl = new RegExp(`^${escapedBase}/?(index\\.html)?$`)

export default defineConfig({
  base,
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: false,
      includeAssets: ['icons/*.png'],
      manifest: {
        id: base,
        name: 'Open Telestrator',
        short_name: 'Telestrator',
        description:
          'Draw over any live video tab. A free, open-source sports telestration studio.',
        theme_color: '#0b0f14',
        background_color: '#0b0f14',
        display: 'standalone',
        orientation: 'any',
        start_url: `${base}app.html`,
        scope: base,
        icons: [
          { src: 'icons/pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          {
            src: 'icons/maskable-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        // Offline, a navigation lands in the studio. The landing page's own
        // addresses are denylisted so they are served by the precache (or the
        // network) rather than the studio shell.
        navigateFallback: 'app.html',
        navigateFallbackDenylist: [homeUrl],
      },
    }),
  ],
  build: {
    rollupOptions: {
      input: {
        home: 'index.html',
        app: 'app.html',
      },
    },
  },
})
