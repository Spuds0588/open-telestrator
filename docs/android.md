# Android phones and tablets

Status: **built, signed and driven on an emulated tablet.**
`src-tauri/gen/android` is committed, the shell compiles for
`aarch64-linux-android`, and a **signed release APK** of the studio runs: the
studio replaces the notice, the rail moves to the bottom on a phone-shaped
viewport, and a finger draws a stroke. What is still missing is anything measured
on *real* hardware rather than an emulator, and a store listing.

```bash
npm run android        # tauri android dev — needs the SDK, the NDK and a device
npm run android:build  # tauri android build — APK + AAB, signed when keystore.properties exists
```

The toolchain these were built with, on a machine that had none: JDK 17 (Temurin),
Android SDK with `platforms;android-37.0` and `build-tools;37.0.0`, and NDK
`29.0.13846066` — the version the Tauri CLI looks for. `ANDROID_HOME`, `JAVA_HOME`
and `NDK_HOME` are what `tauri android` reads; nothing else has to be set.

## What a phone gets, and what it does not

The web app stays desktop-only: a phone opening
`https://spuds0588.github.io/open-telestrator/app.html` still gets the notice
pointing at the downloads, because a phone browser cannot capture a screen and
has no pointer to draw with. **Inside the Android shell that rule is inverted**,
and only there. The shell reports its own shape through `src/lib/desktop.ts`
(`shellMode()` → `browser` | `desktop` | `mobile`) and `useLayout` lays the body
out for it; one CSS rule (`body.desktop`) swaps the notice for the studio. The cameraman (`?camera=`) and viewer (`?watch=`) entries are untouched:
they already work on a phone in any browser, and they keep working inside the
app.

Two desktop-only ideas do not come across to this target:

| | on a phone |
| --- | --- |
| **Control mode** | not offered. There is no window underneath to hand the pointer to, and Tauri's `set_ignore_cursor_events` is desktop-only. The rail has no Control tile (`controlMode` in `App.tsx`), so the panel that switches it cannot be opened. |
| **The update check** | not offered. A release carries desktop executables, so pointing a phone at the release page would hand it the wrong file — a phone's update path is the store or a sideload, not this. `useUpdates` asks the shell for its *shape* and stays inert unless it is a desktop window; the tray's manual **Check for updates**, which is the way back for a muted operator, does not exist on a phone either. |
| **Capturing a tab or the screen** | not offered, and now not drawn either. Android's WebView has no `getDisplayMedia`, so the picker asks the platform (`canShareScreen` in `src/lib/capture.ts`) and leaves the row out. The camera is the only capture a phone has; the rule is the capability rather than the shell, so a desktop webview that lacks the API is treated the same way. |

Stream-out to RTMP is *not* gated: the publisher crate compiles anywhere Rust
does, so the Broadcast panel is there. Whether a phone can produce a program to
send is a different question — see *What is uncertain*.

## Running it on the phone

A tablet or phone telestrator is used with a camera pointed at the pitch and a
finger or a stylus on the glass, so the app has to hold up when:

- the whole app is a bottom bar and a sheet, because a phone held vertically has
  no room for a 92px rail beside a 280px panel;
- the operator is drawing with a stylus while their hand rests on the screen;
- the viewport is a shape nobody designed for — split screen, a foldable
  half-open, a phone mirrored into a portrait monitor.

### Touch and stylus

The rules live in `src/lib/touch.ts` and are tested in `touch.test.ts`; the
components ask, they do not decide.

- **The rail goes along the bottom.** `layoutFor()` answers `rail: 'bottom'` and
  `panel: 'sheet'` whenever a touch device is narrower than 1024 — a phone either
  way up, a tablet in portrait. At 1024 and above the layout is the one a desktop
  gets, so the same code serves a tablet in landscape without a second design.
- **The controls grow to a fingertip.** `body.touch` raises the small controls
  (`.chip`, `.btn`, `.icon-btn`) to `MIN_TARGET`, 44px on the short side. That is
  `AGENTS.md`'s 40px floor with a margin, and it is the number a new control gets
  checked against.
- **A stylus draws thicker when it presses.** `strokeWidth()` doubles the reported
  pressure and clamps it, so a pen that reports 0.5 — and every finger and mouse,
  which report exactly that — draws the configured width, while a deliberate
  press draws up to 1.6× and a light one down to 0.6×. The width is fixed for the
  rest of the stroke on purpose: a stroke carries one width on the wire, shared
  with the co-hosts, and per-point pressure would be a change to that protocol
  rather than to this rule.
- **A palm is not an intent.** Once a stylus has been seen on the canvas, every
  touch is refused for `PALM_WINDOW_MS` (1.5s) afterwards. A finger that has
  never shared the glass with a stylus is somebody drawing with a finger, so
  nothing is refused for them.
- **The canvas never scrolls.** `touch-action: none` on the overlay, and
  `overscroll-behavior: none` on the body, stop a drag from being read as a pan
  and a long press from opening a menu over a broadcast. Buttons get
  `touch-action: manipulation` so no tap waits for a double-tap that is never
  coming.
- **The safe areas are respected.** The sheet's padding and the update prompt
  both use `env(safe-area-inset-*)`, so nothing hides under a notch or a gesture
  bar.

### Viewports nobody designed for

`layoutFor()` takes the shape it is given and always answers; `touch.test.ts`
pins the shapes that are most likely to break something: 320×568 and its
landscape (the smallest phones still in use), 320×320 (split screen), 600×960 (a
foldable half-open), 1024×600, `720×1440` (a phone mirrored into a portrait
monitor) and 2560×1080. Two invariants are asserted for every one of them: the
panel is a sheet exactly when the rail is along the bottom, and the orientation
is read from the numbers rather than assumed.

## What is already in the repository

```text
src/lib/touch.ts                 form factor, layout, stylus, palm — with tests
src/lib/useLayout.ts             keeps <body data-layout class="touch"> true
src/index.css                    the compact layout, the touch targets, the notice bypass
src-tauri/src/lib.rs             `run()` with #[mobile_entry_point] — what an activity calls
src-tauri/tauri.android.conf.json one plain window, minSdkVersion 24
src-tauri/capabilities/default.json  core + events, and the release URL the opener
                                     may open — valid on every target
src-tauri/gen/android/           the Gradle project the APK is built from
```

The shell had to become a library with a two-line binary (`src-tauri/src/lib.rs`
+ `main.rs`) because `mobile_entry_point` has to sit on a function an Android
activity can call. The desktop build is unchanged by that — `main.rs` calls
`run()` and does nothing else — and `cargo test --workspace` still covers both
members.

`tauri android init` writes `src-tauri/gen/android` once, and it is committed and
edited like any other source. It carries the application id, the icons, the
`minSdkVersion` our config asks for, and — the one thing the generator does not do
for us — the camera and microphone permissions:

```xml
<uses-permission android:name="android.permission.CAMERA" />
<uses-permission android:name="android.permission.RECORD_AUDIO" />
<uses-permission android:name="android.permission.MODIFY_AUDIO_SETTINGS" />
```

It should not guess at them on our behalf, but they are not optional: wry asks
for them at runtime from `RustWebChromeClient.onPermissionRequest` when the page
calls `getUserMedia`, and a permission the manifest does not declare is refused
before any dialog can appear — so without these three lines the studio opens a
camera and gets nothing. The two `uses-feature` entries beside them are
`required="false"`, so the APK stays installable on a device that has neither.

## Signing: the keystore, and what is not in the repository

The APK is signed with a key of this project's own, and every part of that key
lives outside the repository:

- the keystore (`opentelestrator-release.jks`) — in this machine's toolchain
directory, `~/.local/share/ot-android/`, never in a checkout and never committed;
- `src-tauri/gen/android/keystore.properties`, which names the alias, the
  password and the keystore's path. It is gitignored, and so are `*.jks` and
  `*.keystore` in that directory, in case one is ever generated there by mistake.

To make a key of your own, and point the build at it:

```bash
keytool -genkeypair -v -keystore ~/.local/share/ot-android/opentelestrator-release.jks \
  -alias opentelestrator -keyalg RSA -keysize 2048 -validity 10000 \
  -dname "CN=Open Telestrator, O=open-telestrator, C=GB"

cat > src-tauri/gen/android/keystore.properties <<'EOF'
keyAlias=opentelestrator
password=<the store password>
storeFile=/absolute/path/to/opentelestrator-release.jks
EOF
```

`app/build.gradle.kts` reads that file if it is there and wires a `release`
signing config; without it the release build is simply unsigned rather than
failing, which is what a fresh clone has and what a debug build does not need.

**The key never goes in the repository, not even in an Actions secret that is
readable back.** Everything else about this project is reproducible from a
checkout; a signing key is the one artefact that is not, and should not be —
anyone holding it can sign an APK that installs over this one. So there is no
Android job in `.github/workflows/desktop-release.yml`: the desktop builds come
from CI, and the APK is built and signed where the key is.

```bash
source ~/.local/share/ot-android/env.sh
npx tauri android build --apk --target aarch64 --ci
# -> src-tauri/gen/android/app/build/outputs/apk/universal/release/app-universal-release.apk
```

Note that release is the **default**: there is no `--release` flag, and passing
one is an error. `--debug` is the flag that turns it off.

The APK on the `v0.1.1` release — `Open-Telestrator-android-arm64-beta.apk`, with
`<name>-beta` for the same reason the Windows and macOS assets carry it — is
7,115,991 bytes, SHA-256
`7ab56af9ca9e62f7547964c1e71894d866aad1b9d35841bc8d31895497bc6f5d`. That digest
was taken from a fresh `gh release download` rather than from the build, and the
downloaded file was checked rather than trusted: `apksigner verify` reports one
V2 signer, `CN=Open Telestrator, O=open-telestrator, C=GB`, whose SHA-256 matches
the keystore's own fingerprint, and `aapt2 dump badging` reports
`dev.opentelestrator.desktop`, versionCode `1001`, versionName `0.1.1`,
`native-code: arm64-v8a` and `MainActivity` as the launcher. For scale: the debug
APK this replaces was 138 MB, most of it an unstripped 137 MB library; this one is
6.8 MB, with the same library stripped to 5.2 MB.

## What is missing

1. **The rail's bottom bar measured on hardware.** The layout rules are tested, and
   the emulated tablet put the rail along the bottom with 65px tiles, but the
   sizes a thumb actually reaches are a matter of holding the device. A stylus and
   a program pushed out to an RTMP platform from the device are the other two
   measurements nobody has taken.
2. **A store listing.** The APK is signed and installable over an older copy of
   itself, which is the part that mattered for upgrades, but a store also wants an
   AAB, a listing and — for the biggest one — a Play signing key. No AAB has been
   built or published.
3. **An Intel Android target.** The APK carries `arm64-v8a` alone, so it installs
   on a modern phone or tablet and on nothing older. A second target is a build
   flag, not a code change, and is left until there is a device that needs it.

## What is uncertain

- **The `desktop` cfg on Android — settled, and it found something.** The shell
  compiles for `aarch64-linux-android`, but not silently: `control.rs` imported
  `Emitter` and `WebviewWindow` and declared `WINDOW` outside the desktop half, so
  the fact that the tray, the shortcut and the cursor call are `#[cfg(desktop)]`
  was not true of everything around them. Those are scoped now too, and the check
  is quiet.
- **Screen capture — settled, and it is a no.** `getDisplayMedia` is not a
  function in Android WebView. The camera is the only capture a phone has, and
  `getUserMedia` is present. The picker now asks the *platform* rather than the
  shell (`canShareScreen` in `src/lib/capture.ts`), and that rule was driven end
  to end in a real browser with `getDisplayMedia` deleted before the studio's
  bundle ran: the Add input picker came up with **Camera**, **Open a video file**
  and **Open a stream URL** and no screen row at all. With the API present the row
  is there, so the gate is the capability rather than a guess about the device.
- **WebCodecs — present, but unproven at speed.** The shell's WebView has
  `VideoEncoder` and `AudioEncoder`. Whether a given device has a *hardware* H.264
  encoder reachable from `VideoEncoder`, and whether it keeps up, is still a
  measurement on real hardware. The encoder hook already reports a failure rather
  than pretending, which is the right shape for that answer.
- **Input latency.** A stylus on a WebView canvas is at least one frame behind the
  tip, and a telestrator is judged on exactly that. Nothing here has been tried
  with a stylus — an emulator has none, and a finger drew but says nothing about a
  pen. If it feels wrong on hardware the fix is to draw the draft stroke with
  `pointerrawupdate` events or to paint the draft on a separate, smaller canvas
  rather than in the main one.

## Next steps, in order

1. Try it on real hardware: a stylus, a palm resting on the glass, a rotation
   mid-stroke, and a program pushed out to an RTMP platform from the device.
2. Build the AAB and write the listing — the signed APK has already proved the
   signing path end to end, so this is paperwork and a second artifact.
3. Add `x86_64` (and `armv7`) to the targets if a device turns up that needs one.
