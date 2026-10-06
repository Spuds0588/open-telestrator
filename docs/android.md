# Android phones and tablets

Status: **planned and partly built, not built into an APK yet.** The shell is
already split so that Android can start it, the layout and stylus rules exist with
tests, and the config override is in place. What is missing is the generated
Android project, which needs a toolchain this machine does not have (see *What is
missing*). Nothing here claims an APK exists.

```bash
npm run android        # tauri android dev — needs the SDK, the NDK and a device
npm run android:build  # tauri android build — APK + AAB
```

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
```

The shell had to become a library with a two-line binary (`src-tauri/src/lib.rs`
+ `main.rs`) because `mobile_entry_point` has to sit on a function an Android
activity can call. The desktop build is unchanged by that — `main.rs` calls
`run()` and does nothing else — and `cargo test --workspace` still covers both
members.

## What is missing

The scaffolding command has **not** been run, because this machine has no JDK and
no Android SDK/NDK (`java` is not installed, `ANDROID_HOME` is unset). On a
machine that has them:

```bash
# one-off: JDK 17, the Android SDK and the NDK, then
npm run tauri android init      # generates src-tauri/gen/android (commit it)
npm run android                 # dev build on an attached device
npm run android:build           # release APK + AAB
```

`tauri android init` writes `src-tauri/gen/android` — a Gradle project with the
application id, the icons and the signing config. It is generated once and
committed, and it is what the AAB is built from. The bits it needs from us are
already in place: `tauri.android.conf.json`, the `[lib]` target, and a
capability that is valid on Android.

Beyond the scaffold, the honest list of what a first APK still needs:

1. **A keystore** and the signing config in the generated project. Without it the
   build produces a debug-signed APK, which cannot go on Play and cannot be
   upgraded in place.
2. **A camera path that suits a phone.** Today the operator adds the host's
   cameras (`getUserMedia`) or a screen capture (`getDisplayMedia`). The camera
   path is the one that works on a phone; the screen-capture button should be
   hidden in the mobile shell rather than offered and refused.
3. **An icon set and a store listing.** `src-tauri/icons` has the desktop sizes;
   Android needs the adaptive layer set that `tauri icon` generates.
4. **The rail's bottom bar measured on hardware.** The layout rules are tested,
   but the sizes a thumb actually reaches are a matter of holding the device:
   the bar is 56px tiles today and the panel sheet takes at most 52% of the
   height.

## What is uncertain

- **Screen and camera capture inside Android WebView.**
  `navigator.mediaDevices.getDisplayMedia` is not implemented in Android WebView
  (it is a Chrome-for-Android API), and `getUserMedia` needs the runtime camera
  and microphone permissions declared in the generated project. The camera is the
  path to build on; the screen capture is not, so the mobile shell should say so
  instead of failing quietly.
- **WebCodecs.** Stream-out encodes with `VideoEncoder`/`AudioEncoder`. Android's
  WebView is updatable and recent versions carry WebCodecs, but whether a given
  device has a hardware H.264 encoder reachable from `VideoEncoder` is a
  measurement, not a promise. The encoder hook already reports a failure rather
  than pretending, which is the right shape for that answer.
- **The `desktop` cfg on Android.** The whole shell is written so the desktop-only
  half is `#[cfg(desktop)]` — the tray, the global shortcut, the cursor call —
  while the opener plugin, the one a phone does want, is registered for every
  target. That reasoning has not been compiled for Android yet, because the NDK is
  not here; the first `cargo check --target aarch64-linux-android` after
  `tauri android init` is where it gets proved, and it is the first thing to run.
- **Input latency.** A stylus on a WebView canvas is at least one frame behind the
  tip, and a telestrator is judged on exactly that. If it feels wrong on hardware
  the fix is to draw the draft stroke with `pointerrawupdate` events or to paint
  the draft on a separate, smaller canvas rather than in the main one.

## Next steps, in order

1. Run `tauri android init` on a machine with the SDK; commit `src-tauri/gen/android`.
2. `cargo check --target aarch64-linux-android` and fix whatever the mobile cfg
   turns up — that is the one claim here that has not been tested at all.
3. Build a debug APK, install it, and measure: does the rail's bottom bar hold at
   320px, does a stylus draw where it points, does a palm stay out of it, does a
   rotation mid-draw lose a stroke.
4. Hide the screen-capture control in the mobile shell, and make the camera the
   first thing the Input panel offers.
5. Only then: a keystore, `npm run android:build`, and a store listing.
