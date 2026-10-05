# open-telestrator

**[▶ Launch the web app →](https://Spuds0588.github.io/open-telestrator/)**

Runs entirely in the browser and installs as a PWA — no account, no download.

Free & open-source sports telestrator & P2P broadcasting studio. Draw over any live video tab, record 30s replays, mix audio, and co-host via PeerJS.

## Status

Desktop-only browser PWA — **capture, telestration, instant replay, stage audio,
and a magic-link cameraman feed**.
Everything lives in one compact sidebar on the right: the drawing tools; an
**Input** stack that shares a tab, starts the host camera and invites
cameraman(s), with every live feed listed as a clickable thumbnail; the **Audio**
mixer (announcer mic and captured tab audio, each with mute, volume and a live
level meter); and **Instant replay**. The 16:9 stage is scaled with `transform`
to fit, so the video keeps its ratio without squeezing the sidebar, and the
telestration canvas draws straight on top. Cameraman invites open a large QR
dialog with a copyable link. Keyboard shortcuts are badges on the controls they
belong to.
Phones and tablets are not supported by this web app and get a notice pointing
at the GitHub releases instead; the cameraman and viewer pages still work on any
device. Shared-drawing collaboration is not built yet.

## Cameraman magic link

On the host, click **🎥 Invite a cameraman** to mint a session link. Opening that
link on a phone loads a tiny cameraman view (code-split, so it never downloads
the host stage) that asks for the camera and streams it to the host over PeerJS.
The transport is strictly **one-way**: the host answers each media call with no
return stream, and the link's per-session token is checked first — a call whose
token does not match is closed without an answer. Accepted feeds appear in the
**Sources** row and can be selected as the program input alongside the shared
screen.

PeerJS's public broker is used by default. To run against your own broker or add
STUN/TURN servers (worth it for cameramen on mobile data), set build-time env
vars — the app itself stays a static front end:

```bash
VITE_PEER_HOST=signal.example.com   # self-hosted PeerJS broker (optional)
VITE_PEER_PORT=443
VITE_PEER_PATH=/
VITE_PEER_KEY=peerjs
VITE_PEER_SECURE=true
# JSON array of RTCIceServer objects; unset → PeerJS's default STUN.
VITE_ICE_SERVERS='[{"urls":"stun:stun.example.com:3478"},{"urls":"turn:turn.example.com","username":"u","credential":"p"}]'
```

## Development

```bash
npm install
npm run dev        # dev server (http://localhost:5173)
npm test           # unit tests (Vitest)
npm run typecheck  # tsc --noEmit
npm run build      # typecheck + production build (also emits the service worker)
npm run preview    # serve the production build
```

Open the app, click **Share a tab**, pick a browser tab, then draw. Use the
**Input** stack to add the host camera or invite a cameraman; click any feed in
the list to put it on the program. The **Audio** section enables and mixes the
announcer mic, and **Replay** plays the last several seconds at 0.5×.

## Hosting

The app is a static front end, so it deploys straight to GitHub Pages. The
[`deploy-pages`](.github/workflows/deploy-pages.yml) workflow runs the unit tests,
builds `dist/` and publishes it on every push to `main`. The repo's **Settings → Pages** source must
be set to **GitHub Actions** once; the site then lives at
<https://Spuds0588.github.io/open-telestrator/>. Because a project site is served
under `/<repo>/`, the workflow sets `VITE_BASE_PATH` to match (local dev stays at
`/`).

## Stack

Vite + React + TypeScript, packaged as an installable PWA (`vite-plugin-pwa`).
The web build is deliberately shell-agnostic so a Tauri desktop/Android shell
can wrap the same `dist/` output later without rework.
