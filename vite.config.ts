import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig(() => {
  // GitHub Pages serves a project site from https://<owner>.github.io/<repo>/,
  // so the deploy workflow sets VITE_BASE_PATH. Local dev/build keep "/".
  const base = process.env.VITE_BASE_PATH ?? '/'

  // The landing page keeps the bare base address, so it is the one navigation
  // the offline fallback must not swallow — it is precached by filename instead.
  const escapedBase = base.replace(/\/$/, '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const homeUrl = new RegExp(`^${escapedBase}/?(index\\.html)?$`)

  return {
    base,
    plugins: [
      react(),
      // One build for every device now, so the worker is always generated: it is
      // what lets an installed studio open without a network, and a phone is the
      // device that benefits from that most.
      VitePWA({
        registerType: 'autoUpdate',
        // The registration itself is in `src/main.tsx`.
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
          // These two have to be spelled out, and that is not obvious: the plugin
          // only applies them itself when it is the one injecting the
          // registration (`injectRegister: 'auto'`), and we register from
          // `src/main.tsx` instead. Without them a new worker installs and then
          // *waits* — `skipWaiting()` would only ever be called by a message
          // nobody sends — so an open studio, which on a phone can be open for
          // days, keeps running the bundle it opened. That is precisely how a
          // phone came to serve a months-old build. `skipWaiting` activates the
          // new worker at once and `clientsClaim` puts open pages under it, which
          // is what lets the autoUpdate reload below fire while the page is live.
          skipWaiting: true,
          clientsClaim: true,
          // Offline, a navigation lands in the studio. The landing page's own
          // addresses are denylisted so they are served by the precache (or the
          // network) rather than the studio shell.
          navigateFallback: 'app.html',
          navigateFallbackDenylist: [homeUrl],
          // hls.js is only fetched when a playlist is opened, so it must not sit
          // in the precache: an installed app would download it for everyone.
          globIgnores: ['**/hls-*.js'],
        },
      }),
    ],
    build: {
      rollupOptions: {
        input: {
          home: 'index.html',
          app: 'app.html',
        },
        output: {
          // A stable name so the workbox glob above can keep it out of the
          // precache; the import stays dynamic either way.
          manualChunks: (id) => (id.includes('node_modules/hls.js') ? 'hls' : undefined),
        },
      },
    },
  }
})
