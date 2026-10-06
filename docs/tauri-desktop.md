# Desktop build (Tauri)

Status: **built and verified on Linux**. The shell runs, Control mode works, and
the program goes out to an RTMP platform. What is not done yet is packaging
(signing, notarisation, the updater) and `rtmps://`; both are listed under
*What is left*.

```bash
npm run desktop        # dev: vite + the shell, with hot reload in the webview
npm run desktop:build  # a signed-less bundle for the current platform
```

The web app is untouched: `npm run build` still produces the GitHub Pages
bundle, and its tests still prove it.

## What the shell adds

Two things a browser cannot do, and nothing else.

1. **A window that can ignore the pointer.** In *Draw* mode the window takes
   clicks and the canvas draws — what the web app has always done. In *Control*
   mode `set_ignore_cursor_events(true)` makes the whole window invisible to the
   pointer, so clicks land on the video, page or application underneath. The mode
   is one switch, not a modifier, and the rail's **Control** panel (a tile only
   the desktop build has) is where it lives.
2. **An RTMP socket.** A webview has no RTMP API, so Rust owns the connection
   and pushes the program to a platform such as YouTube Live.

## The shape of it

```
src-tauri/
  Cargo.toml           workspace root; media/ is a member
  tauri.conf.json      one window, transparent, loading app.html
  capabilities/        core:default + core:event:default
  src/main.rs          bootstrap, tray, global shortcut
  src/control.rs       draw <-> control, and the one window call behind it
  src/stream.rs        the stream-out commands, and the frame wire format
  media/               RTMP publisher — no dependencies at all
    src/amf0.rs        AMF0, only the types RTMP commands use
    src/flv.rs         FLV tag bodies: H.264, AAC, onMetaData
    src/chunk.rs       RTMP chunk framing, both directions
    src/timing.rs      the encoder's clock onto the wire's clock
    src/url.rs         ingest address + key -> host, app, stream name
    src/session.rs     one connection: handshake, commands, the frame pump
    src/publisher.rs   the handle the app holds, and its status
```

The webview half lives in `src/lib`, behind one flag:

```
src/lib/desktop.ts       the only place that knows it is in a shell
src/lib/controlMode.ts   the mode rules, with tests
src/lib/streamOut.ts     destinations, the form's validation, key masking
src/lib/encoder.ts       which codecs and bitrate to ask for, with tests
src/lib/programEncoder.ts the WebCodecs pipeline
src/lib/useStreamOut.ts  the controller the studio drives
src/lib/frameHeader.ts   the frame wire format, mirrored in stream.rs
```

### One window, not two

The earlier plan called for two windows — a click-through stage and an ordinary
studio — so the controls could stay clickable while the overlay passed clicks
through. That has been dropped, because the stroke stack, the display capture and
the broadcast all live in one webview: two windows would mean two React trees and
two stroke stacks, which is the one thing a telestrator must not have. Since a
click-through window cannot be clicked, the way back out is the **global shortcut
(`Ctrl/Cmd+Shift+D`)**, the **tray icon** and the rail's own switch — none of
which live inside the window in a way the mode can swallow. That is the whole of
what the two-window design was for, without the fork.

Tauri can only make a whole window ignore cursor events; per-region pass-through
is still open upstream (tauri-apps/tauri#13070). A single-window telestrator wants
exactly the thing Tauri can do.

### Control mode and the picture

The window is `transparent: true`, and in Control mode the body takes a `control`
class that makes the background, the rail and the stage transparent and
`pointer-events: none`. So the window becomes a clear pane over whatever is
beneath it — you see and touch the real application, not our capture of it.

`pointer-events: none` is the second lock on the door. The OS should never
deliver a pointer event in Control mode; if one arrives anyway on a platform
whose pass-through misbehaves, it still cannot commit a stroke nobody drew.
Strokes already on air stay on air: the mode touches nothing about the
compositor.

## Stream-out

```
canvas ──► VideoEncoder (H.264, AVCC) ─┐
          ─► AudioEncoder (AAC)  ──────┤ one IPC call per encoded frame
                                       ▼
                        Rust: FLV tag bodies ► RTMP ► the platform
```

The boundary carries **encoded** frames, never pixels. That is what makes it
cheap enough to be ordinary IPC: a 1080p30 broadcast is a few hundred kilobytes a
second, where raw frames would be hundreds of megabytes and would need shared
memory to be viable at all.

The picture is sampled from the element that already shows the program, so what
goes out is exactly what viewers see — drawings, corners and all.

`useProgramCompositor` is turned on for stream-out as well as for viewers
(`active: broadcast.status === 'live' || streamOn`), and it is turned on
*before* the publisher connects: a shell that is told a stream is starting while
the canvas is still blank would send the platform a few seconds of nothing.

### Two facts worth keeping

- **A webview can always encode Opus and RTMP wants AAC.** When only Opus is on
  offer, the app deliberately sends *no* audio and says so, rather than producing
  a stream a platform quietly drops. That decision is
  `audioPlan` in `src/lib/encoder.ts`, and it has tests.
- **Timestamps are rebased in Rust** (`media/src/timing.rs`), per track. An
  encoder's clock starts whenever it likes, and switching the program from one
  source to another — the whole point of a telestrator — can hand you timestamps
  from a different origin. A player handed a timestamp earlier than the last one
  either stalls or jumps.

## What is left

- **`rtmps://`.** Only plain `rtmp://` is implemented. That is not a
  compromise for YouTube or Twitch, which both publish a plain ingest address,
  but Facebook Live only offers `rtmps://` and is therefore not listed as a
  platform. The transport is behind the `Transport` trait in
  `media/src/session.rs`, so a TLS stream is a wrapper rather than a rewrite —
  but note that rustls plus a read timeout is a known state-corruption trap, so
  that work should move the pump to a dedicated reader before it lands.
- **More than one destination at a time.** One publisher at a time, by design:
  a second destination would need a second encoder, and the program is one
  picture. Restreaming to several platforms at once is a different feature.
- **Packaging.** `npm run desktop:build` produces an AppImage and a `.deb`. A
  Windows build needs an NSIS/MSI target and a code-signing certificate; macOS
  needs a `.dmg`, notarisation and the hardened runtime; the updater plugin
  points at GitHub Releases. None of that is wired up, so there is nothing to
  download from the landing page yet.
- **Capture hardening.** `getDisplayMedia` works on WebView2 and WKWebView (after
  the Screen Recording grant) and is unreliable on WebKitGTK. If a webview cannot
  capture, the fallback is Rust-side capture feeding a
  `MediaStreamTrackGenerator`. Not built; the per-platform measurement is not
  done either.
- **Opening a video file** should use a real file dialog and the asset protocol so
  a large file streams from disk rather than being read into memory. The web path
  is unchanged for now.
- **The encoder is in the main bundle.** `programEncoder.ts` is only imported by
  `useStreamOut.ts`, which the studio always loads, so the desktop-only encoder
  code sits in the studio chunk — and, for now, so does its presence in the web
  build's chunk graph. It is dead there (nothing calls it when `isDesktop()` is
  false) but it is not split out. Worth a dynamic import.

## Verified how

- `cargo test -p telestrator-media` — 59 tests, no dependencies, no server: AMF0,
  FLV, chunk framing (both directions, including extended timestamps and a chunk
  size that changes under the reader), URL parsing, timestamp rebasing, and the
  whole handshake and command sequence driven against an in-memory socket.
- `cargo test -p open-telestrator` — the frame wire format the shell parses.
- **End to end against a real RTMP server.** The publisher was pointed at
  `ffmpeg` acting as an RTMP listener and fed real H.264 and AAC extracted from a
  fixture; ffmpeg accepted the publish and muxed it —

  ```bash
  # terminal 1: a real RTMP server that saves what it receives
  ffmpeg -y -listen 1 -i rtmp://127.0.0.1:1935/live/test -c copy -f flv out.flv

  # terminal 2: publish to it, then check the result
  ffprobe -show_entries stream=codec_name,width,height -of csv out.flv
  ```

  Result: h264 320x240 30fps and aac 44100 mono, 60 frames, 2.04 s — the
  handshake, `connect`, `createStream`, `publish`, the metadata tag, both
  sequence headers and every frame arrived intact.
- **The shell boots.** The window exists at 1440x900 titled "Open Telestrator",
  the tray icon is created, and a captured frame of it has content (average luma
  16 with a maximum of 235 — the app's own background and its text, not a blank
  window).
- **The web build is unchanged**: seven rail tiles, no Control tile, no Stream out
  section, no emoji, opening on the Input panel.

## Setting it up on a new machine

To *run* a build: nothing. There is no server to install — Rust opens the RTMP
connection itself — which is why this design was chosen over bundling a media
server and ffmpeg.

To *build* it:

| | needs |
| --- | --- |
| Linux | `libwebkit2gtk-4.1-dev`, `libgtk-3-dev`, `libayatana-appindicator3-dev`, `librsvg2-dev`, `build-essential`, plus Rust (1.77+) |
| Windows | WebView2 (present on Windows 11; the installer ships it otherwise), the MSVC toolchain, Rust |
| macOS | Xcode command line tools, Rust |

Then:

```bash
npm install
npm run desktop:build
```

And to go live to a platform:

1. In YouTube Studio, **Create → Go live → Stream**, and copy the **Stream key**.
2. Use the `rtmp://` ingest address the page also shows, not the `rtmps://` one —
   `rtmp://a.rtmp.youtube.com/live2`. Twitch is `rtmp://live.twitch.tv/app`.
   (The app says so itself if you paste an `rtmps://` address.)
3. In the studio, open the **Broadcast** panel, pick the platform, paste the key,
   and **Stream out**. The key is kept in the window and never shown in full.

Nothing else is needed to finish the setup. Two things to know:

- **The global shortcut may be taken.** If `Ctrl/Cmd+Shift+D` is already bound by
  another application, the shell logs it and you come back out of Control mode
  with the tray icon instead.
- **The stream key is sent over the connection as-is.** Plain RTMP is
  unencrypted, which is what YouTube and Twitch both expect on their plain
  ingest; `rtmps://` is the encrypted one and is the work listed above.
