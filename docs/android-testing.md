# Testing and fixing the Android build

Status: **the steps, not the results.** Nothing in this document has been run
against a real phone yet. The APK has been built, signed, verified with
`apksigner` and `aapt2`, and driven on an emulated tablet
([docs/android.md](android.md)), but every input a person actually uses —
camera, file picker, stream URL — was tried once on a device, silently did
nothing, and was never diagnosed. This is the procedure for that diagnosis, so
that the session with a phone on the desk does not turn into guesswork.

The order matters. Each section answers a question the next one assumes.

---

## Rule zero: prove which build is on the phone

The first attempt at this failed in a way that wasted the whole session: the
phone was running something **other** than the build under discussion, and the
symptom looked exactly like a broken build. Two separate things went wrong and
they are worth telling apart, because only one of them can happen inside the
APK.

- **In a phone browser**, the app is fetched, and a service worker can serve a
  stale copy of it. That is what happened: the browser loaded a bundle months
  out of date, which is why it showed a screen-capture button that the current
  build does not draw at all (see *The stale-bundle signature* below).
- **Inside the APK**, this is impossible. The frontend is not fetched; it is
  compiled into `libopen_telestrator_lib.so` by `tauri::generate_context!` and
  served to the WebView from the binary. You can see it in the built library:

  ```bash
  strings -n 12 src-tauri/target/aarch64-linux-android/release/libopen_telestrator_lib.so \
    | grep -E '^/assets/index-.*\.js$'
  # /assets/index-Cnp7wsF-.js
  ```

  So an APK carries exactly **one** bundle, decided when it was built. A stale
  bundle inside the shell can only mean a stale **APK** — which is a much easier
  thing to check, and it is a one-command check, not a four-stage cache
  exorcism.

**Therefore: never judge an Android symptom until `adb` has told you which
build produced it.** This is step 0 of every session.

### The stale-bundle signature

Worth recognising on sight, because it is what misled the first attempt. The
message *"Screen capture isn't available in this browser."* exists in exactly
one place in the source — `unsupportedNotice` for `useDisplayCapture` in
[src/lib/capture.ts](../src/lib/capture.ts) — and it is only reachable when
`canShareScreen()` is **false**. The Add-input screen row is drawn from that
same predicate. So a build that shows **both** the screen-capture button **and**
that message is not a build this repository can produce. If you see that, stop
diagnosing and go check the version; you are looking at old code.

---

## Step 1 — adb, over USB

`adb` is not on the default `PATH`; it comes from the SDK that `env.sh` already
sets up.

```bash
source ~/.local/share/ot-android/env.sh   # puts platform-tools on PATH
adb version
```

On the phone: **Settings → About phone → tap Build number seven times**, then
**Developer options → USB debugging → on**. Plug it in and accept the *Allow USB
debugging* prompt on the phone's screen.

```bash
adb devices -l
```

| what you see | what it means |
| --- | --- |
| `R5CT…	device` | good — `device`, not `offline` or `unauthorized` |
| `…	unauthorized` | the phone is showing a prompt you have not tapped, or you tapped *Deny*. `adb kill-server && adb start-server`, then unlock the phone and re-plug. |
| `…	offline` | the USB mode is charge-only. Set it to File transfer. |
| nothing | try another cable before anything else; charge-only cables are extremely common. |

Wireless is the fallback when the cable is the problem, and it needs the USB
cable once to set up:

```bash
adb pair 192.168.1.x:41234      # the code is under Wireless debugging on the phone
adb connect 192.168.1.x:5555
```

`adb` is the only channel this work needs — no IDE, no Android Studio.

---

## Step 2 — pin the version and the bundle before judging anything

Three questions, all answerable from the command line, and all of them have to
be answered **before** reproducing a bug.

**1. What is installed?**

```bash
adb shell dumpsys package dev.opentelestrator.desktop \
  | grep -E 'versionName|versionCode|firstInstallTime|lastUpdateTime'
```

Expect `versionName=0.1.1` and `versionCode=1001`
(`src-tauri/gen/android/app/tauri.properties` carries both). If the phone says
`0.1.0`, the APK you meant to test was never installed.

**2. Does the installed APK match the file you think you installed?**

`adb install -r` **fails silently-ish** if the signing key differs — it reports
`INSTALL_FAILED_UPDATE_INCOMPATIBLE` and leaves the old app in place, and if you
were not watching the output you now have a phone running two-months-old code
while you debug the new one. The same is true of any install where you ignored
the exit status. Pull what is actually installed and hash it:

```bash
adb shell pm path dev.opentelestrator.desktop        # -> package:/data/app/…/base.apk
adb pull /data/app/…/base.apk /tmp/installed.apk
sha256sum /tmp/installed.apk
```

The release asset's digest is recorded in
[docs/android.md](android.md#signing-the-keystore-and-what-is-not-in-the-repository)
— `7ab56af9ca9e62f7547964c1e71894d866aad1b9d35841bc8d31895497bc6f5d`. A different
hash means a different build; say so and stop.

**3. Which bundle is inside it?**

Because the frontend is compiled into the library, this is a question about the
APK, not about a cache:

```bash
# the APK on disk
unzip -p ~/.local/share/ot-android/Open-Telestrator-android-arm64-beta.apk \
  lib/arm64-v8a/libopen_telestrator_lib.so \
  | strings -n 12 | grep -E '^/assets/index-.*\.js$'

# what the working tree would produce
npm run build && ls dist/assets/index-*.js
```

The hash in the two lines should match the build you think you are testing. Vite
names every asset by content hash, so this is a precise fingerprint of *which
code* is in the APK — stronger than the version number, which is only bumped by
hand in `tauri.conf.json` and `tauri.properties`.

**Installing cleanly.** When in doubt, remove first, so a signature mismatch
cannot leave the old app behind:

```bash
adb uninstall dev.opentelestrator.desktop
adb install ~/.local/share/ot-android/Open-Telestrator-android-beta.apk
```

Uninstalling also clears the granted camera and microphone permissions and the
WebView's stored data, which is usually what you want at the start of a
diagnosis — a permission that was denied once can be silently remembered.

---

## Step 3 — use a build you can see into

**The release APK cannot be inspected, and it logs almost nothing.** Both halves
of that are worth understanding, because they decide how the session runs.

*No inspector.* wry calls `WebView.setWebContentsDebuggingEnabled` only inside

```rust
#[cfg(any(debug_assertions, feature = "devtools"))]
```

so in a release build that call is not in the binary at all and
`chrome://inspect`'s device list stays empty no matter what you do. Nothing you
change on the phone can bring it back.

*No logs.* The generated `Logger` class — which is behind
`RustWebChromeClient`'s console handler, the file-chooser warnings and the
geolocation path — returns early unless `BuildConfig.DEBUG`. So in a release
build the WebView's own `console.log` and its permission decisions are written
nowhere. `adb logcat` will show Chromium internals and not much else.

So there are two usable builds, and they answer different questions:

**`npm run android`** — `tauri android dev`, a debug build. Debugging is on by
default, the Kotlin `Logger` is on, page `console.*` reaches logcat under
`Tauri/Console`, and the bundle is whatever `vite` served over the dev server.
This is the build to *interrogate*: it is where a stack trace or a console error
will actually appear.

**A release-shaped build with the inspector on** — for anything that only breaks
once R8, `strip`, `lto` and `panic = "abort"` are in play, which is the whole
point of testing the release APK and cannot be observed in a debug build. The
shell has an opt-in cargo feature for exactly this:

```bash
source ~/.local/share/ot-android/env.sh
npx tauri android build --apk --target aarch64 --features devtools
# -> src-tauri/gen/android/app/build/outputs/apk/universal/release/app-universal-release.apk
```

`devtools` is `["tauri/devtools"]` in [src-tauri/Cargo.toml](../src-tauri/Cargo.toml),
which reaches `wry/devtools` through `tauri-runtime-wry`, which puts the
`setWebContentsDebuggingEnabled` call back — with Tauri's default of `true`. Both
halves are checked: `cargo check --features devtools` on the host, and
`cargo check --target aarch64-linux-android --features devtools`, which is the one
that matters, because a `cfg` that is only wrong on the phone is the failure mode
`AGENTS.md` records for this target. Both are clean. **The `tauri android build`
command itself has not been run yet** — it needs a Gradle build, which is the
session this document is for.

(To run a bare `cargo` command for Android rather than going through the Tauri
CLI, `env.sh` is not enough: it sets `NDK_HOME` but not the compiler, and the
NDK ships versioned names, so `cc-rs` cannot find `aarch64-linux-android-clang`
and the build stops with `ToolNotFound`. Export the toolchain explicitly:

```bash
BIN=$NDK_HOME/toolchains/llvm/prebuilt/linux-x86_64/bin
export CC_aarch64_linux_android=$BIN/aarch64-linux-android24-clang
export CXX_aarch64_linux_android=$BIN/aarch64-linux-android24-clang++
export AR_aarch64_linux_android=$BIN/llvm-ar
```

`24` is `minSdkVersion`.)

It is off by default, so a shipped APK still carries no inspector.

Either build, then:

```bash
adb devices                    # confirm one device, `device` state
# open Chrome on the laptop:
chrome://inspect/#devices      # tick "Discover USB devices"
```

The WebView appears as a page named `app.html` under
`dev.opentelestrator.desktop`. **Inspect** opens real devtools over adb —
console, sources, network, and the ability to evaluate expressions on the live
page. That last one is the next step.

Note that the release build has no `Tauri/Console` logging, so if you inspect a
`devtools` build, the page's `console.log` output still won't appear in
`adb logcat` unless you also build a debug one. Use the devtools console itself.

---

## Step 4 — the capability probe

Run this in the devtools console (`chrome://inspect`). It is the single most
informative thing to collect, and it takes ten seconds. Every entry is a
capability the studio's architecture depends on, and the ones that matter most
are the ones nobody has ever measured inside Android's WebView.

```js
JSON.stringify({
  shell: {
    ua: navigator.userAgent,
    layout: document.body.dataset.layout ?? null,
    bodyClass: document.body.className,
    origin: location.origin,
    url: location.href,
  },
  dom: {
    videos: document.querySelectorAll('video').length,
    canvases: document.querySelectorAll('canvas').length,
    unsupportedNotice: !!document.querySelector('.unsupported'),
  },
  media: {
    getUserMedia: typeof navigator.mediaDevices?.getUserMedia,
    getDisplayMedia: typeof navigator.mediaDevices?.getDisplayMedia,
    enumerateDevices: typeof navigator.mediaDevices?.enumerateDevices,
  },
  capture: {
    canvas: typeof HTMLCanvasElement.prototype.captureStream,
    element: typeof HTMLMediaElement.prototype.captureStream,
  },
  encode: {
    VideoEncoder: typeof window.VideoEncoder,
    AudioEncoder: typeof window.AudioEncoder,
    MediaRecorder: typeof window.MediaRecorder,
  },
  rtc: {
    RTCPeerConnection: typeof window.RTCPeerConnection,
    addTrack: typeof window.RTCPeerConnection?.prototype.addTrack,
  },
  audio: {
    AudioContext: typeof window.AudioContext,
    createMediaStreamSource: typeof AudioContext?.prototype.createMediaStreamSource,
  },
}, null, 2)
```

### What each answer means

| field | expected | if it is different |
| --- | --- | --- |
| `getDisplayMedia` | `undefined` | **settled**: mobile browsers do not have it and Android's WebView does not either. The studio already gates the screen row on this (`canShareScreen`), so `undefined` is correct behaviour, not a bug. |
| `getUserMedia` | `function` | if `undefined`, the camera can never work and the problem is the shell's WebView, not permissions. |
| `capture.canvas` | `function` — **unmeasured** | **this is the load-bearing one.** The whole broadcast path is a canvas becoming a `MediaStream` for WebRTC. If `canvas.captureStream` is missing, a phone can draw but can never go live, and no amount of permission fixing changes that. |
| `capture.element` | `function` — **unmeasured** | used for camera and tab capture on the desktop; less critical on a phone, but its absence tells you which engine variant you have. |
| `encode.VideoEncoder` | `function` | documented present in the shell's WebView; whether a *hardware* H.264 encoder is reachable is a separate measurement. |
| `rtc.RTCPeerConnection` | `function` | if `undefined` the P2P half of the app is dead on this device and there is no point testing further. |
| `dom.unsupportedNotice` | `false` | `true` means the shell's `body.desktop` marker did not apply and you are looking at the phone-notice page rather than the studio. That alone explains "nothing works". |
| `shell.layout` | `compact` | if `null`/`undesigned`, `useLayout` did not run and the studio is not laid out for touch. |

### Then the real test of the broadcast path

The probe above only says the function exists. This one proves it produces a
live stream, which is what the app actually needs:

```js
(async () => {
  const c = document.createElement('canvas')
  c.width = 320; c.height = 180
  const ctx = c.getContext('2d')
  let n = 0
  const tick = setInterval(() => {
    ctx.fillStyle = `hsl(${n++ * 12} 80% 50%)`; ctx.fillRect(0, 0, 320, 180)
  }, 33)
  const stream = c.captureStream(30)
  const [track] = stream.getVideoTracks()
  const frames = await new Promise((resolve) => {
    const v = document.createElement('video')
    v.muted = true; v.srcObject = stream; v.play()
    let seen = 0
    v.requestVideoFrameCallback(function cb() { seen++; if (seen < 10) v.requestVideoFrameCallback(cb); else resolve(seen) })
  })
  clearInterval(tick)
  return JSON.stringify({ tracks: stream.getVideoTracks().length, frames, settings: track.getSettings() })
})()
```

Ten frames from a canvas means the phone can build and send a program. Anything
else — zero tracks, or a promise that never settles — is the answer to the
question that decides whether the APK can host at all, and it is worth more than
every other measurement in this document.

---

## Step 5 — logcat

Capture a window rather than tailing, so you have something to re-read.

```bash
adb logcat -c                                              # clear
adb logcat -v time > /tmp/ot-logcat.txt &                  # start capturing
# … reproduce exactly one action on the phone …
kill %1                                                    # stop
```

Or watch live, filtered to what this app and its WebView say:

```bash
adb logcat -v time Tauri:V chromium:V WryActivity:V AndroidRuntime:E ActivityManager:I '*:S'
```

| tag | how it is produced | when | useful for |
| --- | --- | --- | --- |
| `chromium` | Chromium's own logging, including page console messages | always | JS errors, unhandled rejections, `getUserMedia` failures |
| `Tauri/Console` | `RustWebChromeClient.onConsoleMessage` → `Logger` | **debug only** (`BuildConfig.DEBUG`) | the same page console messages, in a tidier form |
| `Tauri/FileChooser` | `onShowFileChooser` | **debug only** | "Camera permission not granted", temp-file failures |
| `Tauri` | `Logger` with no sub-tag, e.g. `WryActivity`'s package lookups | **debug only** | WebView package identification, geolocation prompts |
| `AndroidRuntime` | the platform | always | a Kotlin/Java crash and its stack trace |
| `libc` / `DEBUG` | the platform | always | a native tombstone — the Rust side crashing |
| `ActivityManager` | the platform | always | permission grants, activity starts, the `ACTION_GET_CONTENT` picker launching and what it returned |
| `cr_Media` / `MediaCodec` / `AudioTrack` | Chromium and the platform | always | the encoder, audio routing |

The **debug-only** column is the reason step 3 says what it says: on the release
APK, four of those tags write nothing at all.

---

## Step 6 — one input at a time

Do these one at a time, clearing logcat between them. An interaction graph is
much harder to read than four separate failures.

Everything here is under the rail's **Input** panel — *Add input* — which, on a
phone, is the bottom bar's Input tile and a sheet. What the picker *should*
offer is **Camera**, **Open a video file** and **Open a stream URL**, and no
screen row at all.

### 6a. Camera

*Do:* Input → Add input → a camera row.

*Expect:* a system permission dialog the first time, then a preview.

*Why it might be silent:* wry asks the platform from
`RustWebChromeClient.onPermissionRequest`, which maps `RESOURCE_VIDEO_CAPTURE` to
`Manifest.permission.CAMERA` and calls `activity.requestPermissions`. A
permission **not declared in the manifest** is refused before a dialog can
appear — but ours are declared
([AndroidManifest.xml](../src-tauri/gen/android/app/src/main/AndroidManifest.xml)),
so that particular failure is already ruled out by reading the source.

*Collect:*

```bash
adb shell dumpsys package dev.opentelestrator.desktop | grep -A20 'runtime permissions'
```

The dialog appearing and being granted but the preview staying black is a
different bug from the dialog never appearing, and the logcat window will show
which one you have.

### 6b. Open a video file

*Do:* Input → Add input → Open a video file.

*Expect:* the system's Documents UI (or Files) opens; picking a clip adds a feed
card and draws its first frame.

*Why it might be silent:* `onShowFileChooser` is implemented and returns `true`
unconditionally, so the callback is claimed. If the chooser intent cannot be
resolved in the activity it is launched from, `filePathCallback` is **never
resolved** — the page then waits forever with no error, which is exactly the
"says nothing, does nothing" shape that was reported. That is a hypothesis to
test, not a finding.

*Collect:* logcat filtered to `ActivityManager` (did an `ACTION_GET_CONTENT`
activity start? did it return `RESULT_CANCELED`?) and `Tauri/FileChooser` in a
debug build.

### 6c. Open a stream URL

*Do:* Input → Add input → paste an HLS `.m3u8` → open.

*Expect:* a feed card with a picture within a few seconds; `hls.js` is loaded
lazily and the stream is re-drawn onto a canvas at 30fps, capped 1280×720.

*Watch for the scheme.* `android:usesCleartextTraffic` is set from a build
variable in the manifest, so a plain `http://` URL may be refused by the platform
before `hls.js` ever sees it. **Use `https://` for the first test**, and if only
`http://` is available, that is a finding about the manifest rather than about
the media path. `isUnsupportedStream` in [src/lib/mediaFeeds.ts](../src/lib/mediaFeeds.ts)
refuses `rtsp://` and `rtmp://` by design — those are not bugs.

### 6d. Draw, then broadcast

*Do:* draw a stroke with a finger, then open Broadcast and go live; open the
viewer link on the laptop.

Drawing and broadcasting fail for different reasons and should be confirmed
separately. If step 4's canvas-capture snippet returned ten frames, a black
viewer picture is a signalling problem; if it returned nothing, there is nothing
to debug downstream of it.

### 6e. Stylus and palm — by hand

No command line helps here, and it is the one thing an emulator could not test.
Three questions: does a stylus draw at a sensible width when pressed; does a
resting palm stop drawing once the pen has been seen (the `PALM_WINDOW_MS`
window is 1.5s); does the stroke land under the tip rather than trailing it. The
latency one is the judgement a telestrator lives on — if it feels wrong, the fix
in [docs/android.md](android.md) is to draw the draft stroke from
`pointerrawupdate` or on a separate canvas.

### 6f. Stream out to RTMP — the only thing the APK alone can do

*Do:* Broadcast → a platform → start, from the phone, with a real ingest URL.

This is the feature that no other build of this app has: a phone that cannot
capture its screen can still be a camera, a drawing surface and a publisher. It
has **never been dialled** — neither from a phone nor from the desktop build.
Whether it works decides whether the APK has a reason to exist; see step 8.

---

## Step 7 — where each likely fix would go

Written down now so a discovery with a phone in hand does not turn into
archaeology later.

| symptom | most likely home |
| --- | --- |
| camera or mic dialog never appears | `AndroidManifest.xml` permissions (already declared) or wry's `onPermissionRequest` mapping |
| camera granted, preview black | the page's own `getUserMedia` handling — [src/lib/mediaErrors.ts](../src/lib/mediaErrors.ts), whose classifier already maps each failure to a sentence |
| file chooser never opens | `RustWebChromeClient.onShowFileChooser` — a **generated** file, but `gen/android` is committed source and edited like any other |
| file chooser opens, picking does nothing | the activity's `onActivityResult` plumbing in `WryActivity`/`TauriActivity` |
| `canvas.captureStream` missing | nothing small: the program is a canvas stream, and no shim turns a canvas into one. Would need `VideoEncoder` + `MediaStreamTrackGenerator` (Insertable Streams) — a different program path, not a patch. |
| HLS over `http://` refused | `usesCleartextTraffic` in the manifest, or accept https-only |
| stylus latency | draft-stroke rendering, as in [docs/android.md](android.md) |
| the studio does not appear at all | `shellMode()` → `body.desktop` — [src/lib/desktop.ts](../src/lib/desktop.ts), [src/lib/useLayout.ts](../src/lib/useLayout.ts) |

Everything here is a change in the repository. Nothing in this document
advocates patching the phone.

---

## Step 8 — the decision the measurement has to settle

The question underneath all of this is not "does the camera work". It is:

> **Is streaming the program out to RTMP the APK's only remaining job?**

Nearly everything else the shell adds to the web app is already refused by a
capability check rather than by the shell, and is therefore available in a plain
phone browser too: camera capture, an opened video file, an HLS stream URL, a
touch layout with a bottom rail and a sheet, `MIN_TARGET` controls, stylus
pressure, palm rejection, drawing, and P2P broadcast.

The one thing the web app cannot offer on a phone — **and cannot be made to** — is
capturing another app's screen. `getDisplayMedia` does not exist in any mobile
browser or in Android's WebView. That is settled, and the picker already leaves
the row out.

So the phone story has two possible shapes, and the RTMP measurement picks
between them:

- **If RTMP stream-out works from the phone**, the APK earns its place: a phone
  or a tablet becomes a camera-plus-drawing-surface that publishes straight to
  YouTube Live or Twitch, with no laptop in the chain.
- **If it does not**, the APK is a heavier way to run a web page, and the honest
  move is to stop maintaining it — delete `src-tauri/gen/android`, the
  `android` scripts and the signing narrative, and point phones at the browser
  app instead. That is a legitimate outcome and cheap to execute, which is
  precisely why the measurement should come before the next round of Android
  polish.

Either way, record the answer in [docs/android.md](android.md) and update its
status line, which currently promises hardware that has not been held.

---

## What "working" looks like

The acceptance list for the session, in the order it is worth checking. Every
line is a measurement, not an impression:

1. `adb devices` reports `device`, and `dumpsys` reports `versionName=0.1.1`.
2. The bundle hash inside the installed APK matches the one the working tree
   builds.
3. The capability probe returns `capture.canvas: "function"` and the canvas
   snippet yields 10 frames.
4. `getDisplayMedia` is `undefined` **and no screen row is drawn** — the gate
   working, not a bug.
5. The studio appears (`unsupportedNotice: false`, `layout: compact`) with the
   rail along the bottom and 44px controls.
6. Camera: dialog, grant, live preview.
7. File: picker opens, a clip adds a feed and shows a frame.
8. URL: an https `.m3u8` plays.
9. A finger draws; a stylus draws with pressure; a resting palm does not.
10. A viewer on the laptop sees the phone's program.
11. RTMP: a phone-originated program appears on a real ingest.
12. Nothing in steps 1–11 wrote an error to logcat.

Steps 6–9 are the ones a phone browser also passes, which is the argument behind
step 8.

---

## With no phone in the room

Useful work that needs no device, in rough order of value:

- **Write a machine-readable capability report.** The probe in step 4 is a
  hand-copied snippet; the same questions answered by code and shown in the
  studio's own Hardware panel would make every future bug report carry its own
  environment, and would let the web build say what it cannot do *before* a
  button is pressed.
- **Add `x86_64` to the targets** so an ordinary emulator can be part of the
  loop — `arm64-v8a` alone is why the current APK needs a real phone at all.
- **Build the AAB and write the store listing** — the signed APK has already
  proved the signing path end to end, so this is paperwork and a second
  artifact ([docs/android.md](android.md)).
