# open-telestrator

**[▶ Launch the web app →](https://Spuds0588.github.io/open-telestrator/)**

Runs entirely in the browser and installs as a PWA — no account, no download.

Free & open-source sports telestrator & P2P broadcasting studio. Draw over any live video tab, record 30s replays, mix audio, and co-host via PeerJS.

## Status

Browser PWA MVP — **capture, telestration, instant replay, stage audio, and a
magic-link cameraman feed**.
The stage takes three kinds of input: a shared screen, the host's own webcam and
any cameraman feeds; the **Device** row in the sidebar starts the screen, camera
or mic, and the **Feed** row switches which source is on the program. A canvas
overlay draws on top with a **Draw / Control** toggle so pointer events either
annotate or reach the video, and a rolling buffer replays the last several
seconds at 0.5×. The stage mixes the announcer mic and the captured tab's audio,
each on its own volume and mute with a live level meter. A host can mint a link
that turns someone's phone into an extra camera source (see below).
Shared-drawing collaboration is not built yet.

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

Open the app, click **Share a tab**, pick a browser tab, then draw. Use
**Control** to let clicks pass through to the video and **Draw** to annotate.
Use the **Device** row to add the host camera or the announcer mic, and the
**Feed** row to switch the program source. Use **🎥 Invite a cameraman** to add
a phone camera as another source.

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
