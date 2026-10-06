# open-telestrator

**[▶ Launch the studio →](https://Spuds0588.github.io/open-telestrator/app.html)** · [landing page](https://Spuds0588.github.io/open-telestrator/)

Runs entirely in the browser and installs as a PWA — no account, no download.

Free & open-source sports telestrator & P2P broadcasting studio. Draw over any live video tab, record 30s replays, mix audio, and co-host via PeerJS.

## Status

Desktop-only browser PWA — **capture, telestration, instant replay, stage audio,
a magic-link cameraman feed, opened video files and streams, and a viewer
broadcast that fans the composited program out to phones as a PeerJS tree**.
The controls are a rail of icon tiles on the right of the stage with one panel
open in front of it, so no group can scroll out of reach and every tile is sized
for a fingertip or a stylus. Each tile carries its own live badge — how many
inputs are on the stage, whether the mic is hot, who has joined the link, the
viewer count while on air — so a closed panel still says what it is doing.
Clicking the open tile, or the panel's ✕, hides the panel entirely for a
clean picture while broadcasting. The **Input** panel is the one home for
sources: a **＋ Add input** button opens a picker to share a tab, open any of the
host's own cameras (an array of USB cameras shows up as several feeds), drop in a
video file or paste an HLS/MP4 URL; the list below it puts an input on the
program with one click and stops it from the same row; the transport for an
opened file sits under the list, and the panel ends with the **corner camera** —
the picture-in-picture that sits bottom-right on air. Alongside it: the **Audio**
mixer (announcer mic and captured program audio, each with mute, volume and a
live level meter); **Replay**; **Co-hosts**, which mints the invite link and QR,
lists who is connected and can drop one; **Broadcast**; and a **Hardware**
utility at the foot of the rail. Icons are Lucide outlines, bundled with the app
and drawn in the colour of the control they sit in. The 16:9 stage is scaled with
`transform` to fit, so the video keeps its ratio without squeezing the rail, and
the telestration canvas draws straight on top. Cameraman invites open a large QR
dialog with a copyable link. The **Draw** panel stacks its tools, colours and
history as full-width rows with their keyboard shortcuts written on them, so a
mouse, a finger or a pen picks one without a near-miss.
Going live happens from the strip pinned at the top of every panel — the program
on air, the **Go live** button, or the viewer count once live. That same count is
reported to any connected co-host, who can also draw on the same canvas (see
**Shared drawing** below).
Phones and tablets are not supported by this web app and get a notice pointing
at the GitHub releases instead; the cameraman and viewer pages still work on any
device.

## Cameraman magic link

On the host, **Co-hosts → Invite a co-host** mints a session link. Opening it
on a phone loads a tiny view (code-split, so it never downloads the host stage)
that can share the camera and draw on the program — the camera is optional, so a
co-host who is only there to telestrate never has to grant it. Every connected
co-host is listed on the host, with a button to drop it.
The camera path is strictly **one-way**: the host answers the camera call with no
return stream, and the link's per-session token is checked first — a call whose
token does not match is closed without an answer. Accepted camera feeds appear in
the **Sources** row and can be selected as the program input alongside the shared
screen.

A token-checked data channel runs alongside it. Down it the host repeats the
viewer count, so the cameraman can see how many people are watching — repeated
every few seconds rather than sent only on change, so a dropped message cannot
leave a stale number on screen. Both ways over that same channel travel the
drawing operations described next.

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

## Shared drawing with a co-host

The cameraman is also the co-host. Once its channel is open the host calls it
back with the program picture, and both ends draw on the same canvas: a stroke
the co-host makes shows up on the host's stage — and therefore on air — within a
round trip, and a stroke the host makes shows up on the co-host's canvas.

Strokes are already normalized to the frame (0.0–1.0), so a line drawn on a
phone lands in the same place on the broadcast. The co-host draws on the raw
program source, not the composited picture, because the composite already has
the shared strokes burned in and sending that would paint every stroke twice;
both sides letterbox the same source into a 16:9 frame, so the two line up. The
host is the single writer of the stroke stack — it applies each operation, puts
it on air, and forwards it to the other co-hosts — and a co-host never forwards
what it receives, so an operation travels at most one hop and cannot loop.

On the cameraman page the tools live behind **✎ Draw on the program**: the same
tools and colours as the host, with undo and clear. It is a separate mode on
purpose, so the phone keeps showing the camera the rest of the time.

## Inputs: cameras, files and streams

**Cameras.** Every `videoinput` the machine reports is listed under Input; each
one opens independently, stays running while you work the others, and appears in
the feed list with its own live thumbnail. One of them is the program; any other
can sit in the corner (see **On air** below). Device labels appear once the
browser has been granted a camera.

**Files and streams.** **Open file** takes any video the browser can play and
puts it on the stage as an ordinary source, with a transport in the sidebar
(play, pause, scrub, restart) since the telestration canvas covers the picture.
A pasted URL works too: progressive MP4/WebM plays natively, HLS (`.m3u8`) uses
`hls.js`, which is fetched only when a playlist is actually opened.

Two honest limits. **RTSP and RTMP cannot play in a browser at all** — that is
what VLC is for — so those links are refused with a notice rather than failing
silently. And a remote stream must allow this page (CORS), because the feed is
drawn to a canvas on its way to viewers; a server that refuses is reported
rather than turning the broadcast black.

## On air: the program picture

**The stage is the program.** While the broadcast is live, everything the host
sees — the selected video, the corner camera, the live corner during a replay,
and the telestration strokes — is drawn onto one canvas whose stream goes out to
viewers. That is what puts the drawing in front of the audience: strokes are not
a local annotation, they are the broadcast.

- **Corner camera.** Pick any source under **Program → Corner camera** and it
sits in the right-hand corner of the programme, for viewers as well as for the
host — the commentator's own webcam, or a second angle.
- **Live corner.** Start an instant replay and the live feed stays in the
top-right corner while the replay plays big, so nobody misses the next moment.
Replays therefore reach viewers too: the programme follows the stage.

The composited track keeps its identity while you switch sources, replay or
draw, so viewers are not re-connected every time you change something. While the
host's tab is in the background the picture is rebuilt once a second rather than
freezing: a slideshow, not a still frame, until the tab is visible again.

## Broadcasting viewers

Click **Broadcast → Go live to viewers** to mint a viewer link (use **Show QR**
to put a big scannable code on screen). Viewers open the link and are watching
straight away — the page joins the tree on its own, with no Watch button to
find. They get the composited program picture plus the stage audio mix, and
nothing else — no scrubber, no catch-up. A late joiner sees the frames that
arrive after it connects, and its picture drifts independently of everyone
else's. There is no shared timeline to fall behind.

Viewers are arranged as a **tree**, so the host's uplink stays at two streams no
matter how many people watch. Every viewer is also a relay: the host places a
new viewer under whichever node has spare capacity and that node calls it with
the live stream it is already receiving.

Because the tree is full of ordinary browsers that can close, the app heals
itself rather than freezing:

- the host sweeps its viewers and drops any whose transport has failed or gone
  quiet, so a vanished viewer frees its slot instead of holding it forever;
- a viewer whose parent disappears — or whose picture simply stops moving for a
  few seconds — drops its own children and rejoins through the host, and those
  children do the same, so one failure never freezes a whole branch;
- a source that delivers a track but no picture is not treated as success, so a
  dead camera ends with an honest "lost the broadcast" instead of an endless
  reconnect loop.

Broadcasting is one-way to viewers: they never send video or audio back to the
host or to each other.

## What a viewer sees

The viewer page is a player, not a debug view: the picture fills the screen and
the chrome fades out while it plays, coming back on any movement. The bar carries
the controls people already know — play/pause, mute, a volume slider, full screen,
picture-in-picture, and cast where the browser offers it — with a live indicator
that turns amber the moment the picture is no longer live. Clicking the picture
toggles playback, and Space/K, M, F and the arrow keys do what they do everywhere
else. Status is a small chip in the corner rather than a bar under the video.
Opened inside someone else's page, the viewer goes bare and shows the player
alone — see **Embedding the feed** below.

**Picture-in-picture keeps its controls.** Where the browser has Document
Picture-in-Picture, the ⧉ button moves the whole player — picture, controls and
all — into a floating window that stays on top of other work, so you can watch
while doing something else; the controls and the shortcuts keep working there.
A browser without it falls back to video picture-in-picture, which floats the
bare picture, and a browser with neither gets no button. The page behind a
floating player offers to bring it back.

**Pausing keeps what you missed.** While paused, the viewer records what arrives
and counts it up next to the live indicator; resuming plays that recording back
before returning to the live edge when it runs out. The buffer stops growing at
two minutes so a tab left paused overnight cannot eat the machine, and browsers
that cannot record simply rejoin live on resume instead. Audio is buffered along
with the picture.

**On casting.** The cast button appears when the browser implements the Remote
Playback API and hands the element to it, which is the only in-page route to a
TV; AirPlay is enabled for Safari via `x-webkit-airplay`. Casting a *live* WebRTC
stream is limited by the receiver, not by this app: the common fallback that
always works is your browser's own "cast tab" or screen mirroring. Full screen and
picture-in-picture are the browser's own APIs and depend on it permitting them.

## Embedding the feed

A viewer link goes straight into an `iframe`, which is what a portal or a
community page wants: gate the page yourself, and let the picture play inside
it. The viewer page notices that it is framed — or that it was linked from
another site — and drops this app's own chrome, so the frame gets the picture
and the player controls, and nothing else.

```html
<iframe
  src="https://Spuds0588.github.io/open-telestrator/app.html?watch=HOST_ID&t=TOKEN"
  width="960"
  height="540"
  allow="autoplay; fullscreen; picture-in-picture"
  allowfullscreen
></iframe>
```

Nothing else is needed: the feed starts on its own, and the status chip appears
only when something needs attention. If you prefer to spell it out, `embed=1`
forces the bare layout from anywhere and `embed=0` keeps the full viewer page
even inside a frame. The app serves no frame headers of its own, so whether a
page may be framed is entirely the embedding page's business.

## Hardware triggers

Gamepads, USB pedals and button boxes are polled with the Gamepad API — no
permission needed — and MIDI pads or foot controllers are one opt-in away under
**Hardware**. Buttons flip to the next/previous source, start a replay, return
to live, undo and clear. A Stream Deck needs no integration at all: point its
keys at the same shortcuts the app already listens for (`[`, `]`, `R`, `L`, `Z`,
`Delete`, `1`–`4`, `C`, `X`).

## Pages and addresses

There are two pages, both produced by the multi-page Vite build:

- **`/` — the landing page** (`index.html` with its own `src/home.css`): what the
  project is, who it is for and why it is free, written for search engines and
  answer engines. It ships no application JavaScript, only a service-worker
  registration so the site stays installable from the front door. This is the
  page meant to be indexed; `public/robots.txt`, `public/sitemap.xml` and
  `public/llms.txt` all point at it.
- **`/app.html` — the studio** (`src/main.tsx`). It serves all three entries: the
  host studio plain, the cameraman on `?camera=…` and the viewer on `?watch=…`.
  Its content is per-session, so it is `noindex`.

Every viewer, cameraman and QR link the host mints points at `/app.html`
(`buildViewerLink` / `buildCameraLink`), never at the landing page.

## Development

```bash
npm install
npm run dev        # dev server (http://localhost:5173)
npm test           # unit tests (Vitest)
npm run typecheck  # tsc --noEmit
npm run build      # typecheck + production build (also emits the service worker)
npm run preview    # serve the production build
```

`npm run dev` serves the landing page at `/` and the studio at `/app.html`.
Open the studio, click **＋ Add input → Share a tab or screen**, pick a browser
tab, then draw. The same picker opens a camera, drops in a video file or takes a
stream URL; click any input in the list to put it on the program, or its ✕ to
stop it. Invite a co-host from the **Co-hosts** panel. The **Audio** panel
enables and mixes the announcer mic, and **Replay** plays the last several
seconds at 0.5×.

Shortcuts: `1`–`4` tools, `C`/`X` colour, `Z` undo, `Delete` clear, `[`/`]`
previous/next source, `R` replay (play/pause while replaying), `L` back to live.

## Hosting

The app is a static front end, so it deploys straight to GitHub Pages. The
[`deploy-pages`](.github/workflows/deploy-pages.yml) workflow runs the unit tests,
builds `dist/` — the landing page and the studio, together with the PWA,
robots, sitemap and `llms.txt` files — and publishes it on every push to `main`. The repo's **Settings → Pages** source must
be set to **GitHub Actions** once; the site then lives at
<https://Spuds0588.github.io/open-telestrator/>. Because a project site is served
under `/<repo>/`, the workflow sets `VITE_BASE_PATH` to match (local dev stays at
`/`).

## Desktop app

The same studio also runs as a native desktop app, in a [Tauri](https://tauri.app)
shell that wraps the very bundle GitHub Pages serves — nothing about the UI, the
compositor or the drawing is forked. It adds the three things a browser cannot do:

- **Control mode.** In Draw the window takes clicks and you draw on it; in Control
the whole window stops taking clicks, so the pointer belongs to the video, page
or application underneath — you see and touch the real thing, not our copy of it.
Switch with the rail's **Control** panel, `Ctrl/Cmd+Shift+D`, or the tray icon.
- **News of a newer version.** The app asks GitHub a few seconds after launch
whether there is a newer
[release](https://github.com/Spuds0588/open-telestrator/releases), and says so if
there is — the button opens the release page in your own browser. It ships as one
standalone executable with no installer, so it never replaces itself: you
download the new file and run that. If you would rather not be told, the prompt
has a checkbox that turns the notifications off for good — and the tray's **Check
for updates** still answers when you ask.
- **Stream out to RTMP.** Push the program — drawings, corners and all — straight
to YouTube Live, Twitch, Facebook Live, Instagram, Rumble, Trovo, Steam,
Restream, Mux, BoxCast or any other RTMP ingest, without a media server or
`ffmpeg` to install: the app opens the connection itself. Both the plain
`rtmp://` ingest and the encrypted `rtmps://` one work, and the encrypted one is
the only kind Facebook Live, Instagram and LinkedIn publish. The picker lists
around thirty services in groups, and **Something else** takes an address that is
not on it.

```bash
npm run desktop        # run it against the dev server
npm run desktop:build  # the standalone executable, in src-tauri/target/release
```

There is no installer on any platform: a build leaves one executable — about 6 MB,
webview included — and running that file *is* the installation. On Linux and macOS
it wants `chmod +x` first, and a macOS download asks to be allowed once under
**Privacy & Security**.

The Linux download is the build that has been run and checked. The Windows and
macOS ones are labelled **beta**: CI builds them on systems nobody has driven the
app on yet, so expect rough edges there — and on macOS, camera, microphone and
screen-recording access can be refused outright, because a bare executable
carries no app bundle for macOS to hang those permissions on.

To go live to a platform: in YouTube Studio, **Create → Go live → Stream**, copy
the **stream key**, then in the studio open the **Broadcast** panel, pick the
platform, paste the key and **Stream out**. Either ingest address the page shows
works, plain or encrypted (`rtmp://a.rtmp.youtube.com/live2` or
`rtmps://a.rtmp.youtube.com/live2` for YouTube, `rtmp://live.twitch.tv/app` for
Twitch). The key is kept in the window and never shown in full.

Facebook Live and Instagram are in the picker; both publish an encrypted ingest
only, which is what the app's TLS support is for. LinkedIn Live is not, and
cannot be a preset: Live Studio issues its address per event, on a channel that
belongs to your account, so it belongs in **Something else** with what the page
shows you. Any platform that issues a per-account ingest address, like TikTok,
belongs there too.

Building from source needs a Rust toolchain, and on Linux the WebKitGTK and GTK
development packages. See [docs/tauri-desktop.md](docs/tauri-desktop.md) for the
per-platform prerequisites, what is verified, and what is still to do.

## Android

A phone or tablet build is the next target, and it is *only* the shell that is
planned rather than the web app: a phone opening the studio in a browser still
gets the notice pointing at the downloads, because a browser tab cannot capture a
screen and has no pointer to draw with. Inside the Android app the studio is
there, laid out for the device — the rail becomes a bar along the bottom, the
panel a sheet above it, every control at least 44px on its short side, the canvas
taking the stylus and refusing the palm resting on the glass.

The first APK is built, installed and driven on a tablet: the studio comes up
instead of the notice, the rail moves to the bottom, and a finger draws. It is a
**debug** build, signed with the Android debug key, so it sideloads onto a device
but cannot go on Play and cannot be upgraded in place. A signed release needs a
keystore, which is the one thing still missing.

[docs/android.md](docs/android.md) has the plan, the scaffolding commands, and an
honest list of what is uncertain — screen capture, WebCodecs, and how a stylus
feels on a WebView canvas.

## Stack

Vite + React + TypeScript, packaged as an installable PWA (`vite-plugin-pwa`).
The web build stays shell-agnostic so the Tauri desktop shell wraps the same
`dist/` output — and so the Android shell can too. The desktop-only half lives in
`src-tauri/`, including an RTMP publisher written in Rust whose only dependency
is the TLS stack, and a shell that is a library with a two-line binary in front
of it so a phone's activity can start the same code.
