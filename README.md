# open-telestrator

Free & open-source sports telestrator & P2P broadcasting studio. Draw over any live video tab, record 30s replays, mix audio, and co-host via PeerJS.

## Status

Browser PWA MVP — **capture, telestration, instant replay, and stage audio**.
Screen capture binds a tab to a `<video>`, a canvas overlay draws on top with
pointer events that toggle between drawing and letting clicks reach the video,
and a rolling buffer replays the last several seconds at 0.5×. The stage mixes
the announcer mic and the captured tab's audio, each on its own volume and mute
with a live level meter. Peer collaboration is not built yet.

## Development

```bash
npm install
npm run dev        # dev server (http://localhost:5173)
npm run typecheck  # tsc --noEmit
npm run build      # typecheck + production build (also emits the service worker)
npm run preview    # serve the production build
```

Open the app, click **Share a tab**, pick a browser tab, then draw. Use
**Control** to let clicks pass through to the video and **Draw** to annotate.

## Stack

Vite + React + TypeScript, packaged as an installable PWA (`vite-plugin-pwa`).
The web build is deliberately shell-agnostic so a Tauri desktop/Android shell
can wrap the same `dist/` output later without rework.
