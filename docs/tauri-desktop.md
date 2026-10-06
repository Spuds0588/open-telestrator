# Desktop build (Tauri)

Status: **built and verified on Linux**, as a standalone executable. The shell
runs, Control mode works, the program goes out to an RTMP platform — plain
`rtmp://` or encrypted `rtmps://` — and a newer version is announced with a link
to the release page, with an opt-out. Windows and macOS are built by CI and handed
out as beta, the macOS one as a zipped `.app` so its permission prompts have a
bundle to come from; what neither has had is a person at the keyboard, which is
the first thing under *What is left*.

```bash
npm run desktop        # dev: vite + the shell, with hot reload in the webview
npm run desktop:build  # the standalone executable for the current platform
npm run android        # the phone build — see docs/android.md
```

There are **no installers**, by choice: `bundle.active` is `false`, so
`tauri build` leaves `src-tauri/target/release/open-telestrator` and nothing
else. Downloading that file and running it *is* the installation, and the update
path is the same one — get the newer file and run that.

macOS is the one exception, and it is not an installer either: macOS hangs
camera, microphone and screen-recording permission on a *bundle*, so the macOS
download is a minimal `.app` — the same binary, an `Info.plist` and an icon,
assembled by `src-tauri/macos/bundle.mjs` and zipped. Unzipping it and opening it
is still the whole of the installation. *Signing, per platform* is the reasoning.

The web app is untouched: `npm run build` still produces the GitHub Pages
bundle, and its tests still prove it.

## What the shell adds

[README.md](../README.md#where-it-runs) has the table of what the three builds
share and where they differ; this is the desktop half of it in detail — three
things a browser cannot do, and nothing else.

1. **A window that can ignore the pointer.** In *Draw* mode the window takes
   clicks and the canvas draws — what the web app has always done. In *Control*
   mode `set_ignore_cursor_events(true)` makes the whole window invisible to the
   pointer, so clicks land on the video, page or application underneath. The mode
   is one switch, not a modifier, and the rail's **Control** panel (a tile only
   the desktop build has) is where it lives.
2. **An RTMP socket.** A webview has no RTMP API, so Rust owns the connection
   and pushes the program to a platform such as YouTube Live.
3. **A way to hear about a new version.** The app asks the GitHub API once,
   shortly after launch, and says so when there is one — with a button that
   opens the release page in your own browser, not a download it performs itself.
   See *A newer version*.

## The shape of it

```
src-tauri/
  Cargo.toml           workspace root; media/ is a member
  tauri.conf.json      one window, transparent, loading app.html, and
                       `bundle.active: false` — a build makes one executable
  tauri.android.conf.json  one plain window; see docs/android.md
  capabilities/        core:default + core:event:default, plus the one address
                       the opener may hand to the system's browser
  src/lib.rs           bootstrap, tray, global shortcut, the opener plugin
  src/main.rs          two lines: calls lib.rs's run()
  src/control.rs       draw <-> control, and the one window call behind it
  src/stream.rs        the stream-out commands, and the frame wire format
  media/               RTMP publisher — TLS is its only dependency
    src/amf0.rs        AMF0, only the types RTMP commands use
    src/flv.rs         FLV tag bodies: H.264, AAC, onMetaData
    src/chunk.rs       RTMP chunk framing, both directions
    src/timing.rs      the encoder's clock onto the wire's clock
    src/url.rs         ingest address + key -> host, app, stream name
    src/tls.rs         the encrypted socket, for an rtmps:// ingest
    src/session.rs     one connection: handshake, commands, the frame pump
    src/publisher.rs   the handle the app holds, and its status
```

The webview half lives in `src/lib`, behind one flag:

```
src/lib/desktop.ts       the only place that knows it is in a shell
src/lib/controlMode.ts   the mode rules, with tests
src/lib/streamOut.ts     destinations, the form's validation, key masking
src/lib/encoder.ts       which codecs and bitrate to ask for, with tests
src/lib/programEncoder.ts the WebCodecs pipeline, imported on demand
src/lib/useStreamOut.ts  the controller the studio drives
src/lib/frameHeader.ts   the frame wire format, mirrored in stream.rs
src/lib/updates.ts       version comparison, release notes, the opt-out, with tests
src/lib/useUpdates.ts    the announcement the studio drives
src/lib/touch.ts         phones, tablets, styluses, awkward viewports, with tests
src/lib/useLayout.ts     keeps the body's layout attributes true
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

## The platform presets

`src/lib/streamOut.ts` holds the ingest addresses the picker offers, grouped by
what the platform is for: live platforms, regional ones, sport/worship/events,
and restream and pro-video services. Its tests hold three rules, so a preset that
breaks one fails `npm test` rather than shipping:

1. **A scheme the publisher can dial.** Both plain `rtmp://` and encrypted
   `rtmps://` are accepted now that the TLS half exists, so Facebook Live and
   Instagram — which publish an encrypted ingest and nothing else — are in the
   list. A preset may still not point at something the publisher cannot reach at
   all, like an `http://` page.
2. **One address for everybody, and a host plus one path segment.** Amazon IVS
   issues each channel its own ingest subdomain, TikTok issues a per-region host
   and LinkedIn Live issues a per-event address on a channel that belongs to the
   account (`<channel>.channel.media.azure.net:2935/live/<key>`), so none can be
   guessed for you — all three are left to **Something else**, where you paste
   what the dashboard gave you. niconico is out for the same family of reason:
   its fixed `/live/input` would arrive as an application plus a stream name,
   because this form and `media/src/url.rs` both read the first path segment as
   the application and the rest as the stream name.
3. **No adult services.** A telestrator is used next to a pitch or a court.

No preset carries a key — `address` is the platform's and `key` is always yours.
The addresses are the ones the services publish themselves, most of them
cross-checked against the maintained list OBS ships. They have *not* each been
connected to here: without an account on each service there is no way to test
them, and a stale address fails exactly the way a mistyped one does — the
publisher reports the rejection and the panel shows it.

## Encrypted ingests

Facebook Live, Instagram and LinkedIn publish their ingest over TLS and nothing
else, so `rtmps://` is the difference between three of the platforms people
actually stream to and a picker that cannot reach them.

`media/src/tls.rs` is the whole of it, and it is the one place this crate takes a
dependency (`rustls` and `webpki-roots`, with `ring` as the crypto provider so a
builder needs a C compiler and nothing more). The transport was already behind
the `Transport` trait, so this is a wrapper rather than a rewrite — but the
wrapper is not the naive one, because a TLS record cannot be interrupted halfway
and resumed later, and the pump reads on a short timeout so it can alternate with
writing frames. Instead the socket's read side belongs to a **dedicated reader
thread** that blocks on it with no timeout and hands decrypted bytes over a
channel; the pump's `read` waits on that channel for its timeout and reports
`WouldBlock` when it is empty, which is exactly what it already expected from a
plain socket. Writes stay inline on the pump's thread, because two writers would
interleave TLS records. The `ClientConnection` is shared behind a mutex, and no
blocking socket call is ever made while holding it.

Nothing is ever downgraded: an `rtmps://` address gets TLS or an error, and a
certificate that does not verify is reported as its own failure rather than
connected to.

## A newer version

The app asks the GitHub API once, a few seconds after launch, whether there is a
newer release than the one running. A newer version is news and a link — never a
download this process performs:

```text
api.github.com/…/releases/latest ──► tag_name + body + html_url
                                            │
                       isNewer(tag, running)│
                                            ▼
                              the prompt, with a link
```

**The API, not the updater plugin's signed manifest.** The plugin installs
*bundles*: on Windows it runs the NSIS or MSI installer, on Linux it renames the
running AppImage aside and unpacks, or reaches for `pkexec`, and on macOS it
replaces the `.app` from a tarball. A standalone executable has nothing for any
of that to act on — and a signature exists to protect an install that does not
happen here — so the check is one unauthenticated `GET` and the answer is a
version, some notes and a URL. `RELEASES_API` and `releaseFromApi` in
`src/lib/updates.ts` are the whole of it; the request itself is
`checkForUpdate` in `src/lib/desktop.ts`.

The endpoint is `api.github.com/repos/Spuds0588/open-telestrator/releases/latest`.
Unauthenticated it is rate-limited to 60 requests an hour per address, which one
check per launch never approaches, and the response carries
`Access-Control-Allow-Origin: *`, so it needs no proxy and no plugin. Two things
the API does for us: a **draft** release is not returned at all, and a tag that
is not a version is read as nothing (`releaseFromApi` refuses both), so nothing
is ever announced that cannot be named.

**Nothing is downloaded by the app.** *Get the new version* hands the release's
`html_url` to the system browser through `tauri-plugin-opener` — which works on a
phone too, the other build with no browser chrome of its own — and the capability
in `src-tauri/capabilities/default.json` allows exactly one address shape, this
project's releases. The operator gets to see the page, the asset names and
whatever the release says about them before anything runs on their machine, which
is the honest shape of a standalone download.

### The opt-out

An update prompt is an interruption, and people have strong feelings about being
interrupted, so there is a checkbox in the prompt itself: *Do not tell me about
new versions*. It is remembered in `localStorage` under
`open-telestrator.updates.notify` and it survives restarts.

What it switches off is **being told**, not **asking**: the tray's **Check for
updates** answers whether or not the box is ticked, and so opens the prompt with
the box in it — untick it and announcements come back. That is the whole way back,
which is what keeps the checkbox from being a trap. The rules are in
`src/lib/updates.ts` (`shouldPrompt`, `readMuted`, `writeMuted`) with tests, and
nothing in them needs a shell or a network to be reasoned about.

The prompt is hidden in Control mode, because a window that ignores the pointer
cannot be clicked — which is also why the check is reachable from the tray.

### What it says when there is nothing to say

Nothing. A check that finds nothing is silent, as is one that cannot reach the
API (no network, or no release published yet — a 404 is the answer until the
first tag). Only a check the operator asked for reports either answer, and it
says so in one line for a few seconds. An app that nags about having nothing to
say is an app people switch off.

## Releasing

`.github/workflows/desktop-release.yml` builds the three platforms and files a
**draft** release when a `v*` tag is pushed:

```bash
git tag v0.1.0 && git push origin v0.1.0
```

The tag has to match `version` in `src-tauri/tauri.conf.json` — that is the
number a running copy compares itself against. The workflow runs the web tests
and the Rust tests first, then `npx tauri build` on each of `ubuntu-22.04`,
`windows-latest` and `macos-latest`, copies the binary to a per-platform asset
name and uploads it with `gh release upload --clobber`. On macOS it wraps the
binary in an `.app` first (`plutil` lints the plist, `codesign --sign -` ad-hoc
signs the bundle, `ditto` zips it) — see *Signing, per platform*. The draft is
published by hand.

### Only the Linux build is labelled as verified

| asset | |
| --- | --- |
| `Open-Telestrator-linux-x86_64` | the build that has been run and checked |
| `Open-Telestrator-windows-x86_64-beta.exe` | beta — built by CI, never run by a person |
| `Open-Telestrator-macos-aarch64-beta.zip` | beta — as above; a zipped `.app`, because macOS needs a bundle for the permission prompts |
| `Open-Telestrator-android-arm64-beta.apk` | beta — built and signed by hand rather than by CI (see *Signing, per platform*), and driven on an emulated tablet, but never held |

The APK is not the workflow's to build — it needs the keystore that deliberately
stays off a runner — so it is uploaded to the release by hand. Its label on the
release page is where a reader finds out what it is.

Nothing about the code differs between the four; what differs is how much of it
somebody has watched work. Linux is the machine the shell was developed and
driven on. Windows and macOS are built by a runner nobody has sat at, and Android
by an emulator nobody has held, so all three are handed out as beta, in the
filename and in the release notes.

That label is on the **assets**, never on the release. GitHub's `releases/latest`
— the endpoint the app's update check reads — skips drafts *and* pre-releases, so
flagging the whole release as a pre-release would silence the update notice for
the Linux build as well. A beta asset in a normal release is the only shape that
says "treat this one carefully" without saying "ignore the release". The notes
are what the prompt shows, so they carry the same warning.

**No secrets, and nothing to set up first.** There is no signing key to supply
*to this workflow* — the Android key is used where it lives, never by a runner —
and no `latest.json` to write: the artifact is the executable itself, and the
release the API returns already carries the version and the notes the prompt
shows. The only thing the workflow needs is the `GITHUB_TOKEN` every Actions run
has anyway, with `contents: write` to file the release.

Three things about the draft:

- **A draft is invisible to the API.** `releases/latest` only answers for a
  published release, and `releaseFromApi` filters a `draft` out again, so
  running copies see nothing until somebody publishes. Test the draft, then
  publish it.
- **`max-parallel: 1` is deliberate.** Three jobs each do `gh release view … ||
  gh release create`, and two of them creating at once is a race. Sequential is
  slower and always right.
- **`fail-fast: false`**, so one platform failing still leaves the other two
  uploaded, which is what makes a partial release diagnosable rather than
  invisible.

### Signing, per platform

Nothing here is needed for a build to *work*, and none of it is done here. What
it changes is what the operating system says the first time somebody runs the
file — and on macOS it is more than a warning.

**Windows — SmartScreen.** An unsigned `.exe` runs, and shows *"Windows
protected your PC"* until enough people have downloaded that exact file; **More
info → Run anyway** gets past it. A code-signing certificate (an OV one is
enough; since 2024 an EV one buys no extra reputation) is the fix, and it signs
the binary itself rather than an installer — which also means there is no
`bundle.windows` block for it to go in any more, just `signtool` against the
asset on the runner, with the certificate imported into `Cert:\CurrentUser\My`
first. A `.pfx` (base64 in a `WINDOWS_CERTIFICATE` secret, with its password) or
Azure Trusted Signing are the two usual ways in. None of it is wired up: it needs
the certificate to exist first.

**macOS — a bundle, assembled by hand, signed ad-hoc, and still not notarised.**
This is the one platform where the standalone shape costs something real, and it
is worth writing down plainly. macOS hangs camera, microphone and **screen
recording** permission on a *bundle* with the right `Info.plist` usage strings: an
app with no `Info.plist` has nowhere for those strings to live, so the system
refuses the request outright *instead of* putting a dialog on screen. Those two
inputs are the whole app, so a bare executable is a Mac build that cannot see or
hear. The macOS asset is therefore a zipped `.app`, assembled from the built
binary, `src-tauri/macos/Info.plist` (the usage strings, with the product name,
identifier and version filled in from `tauri.conf.json` so they cannot drift) and
`icons/icon.icns`.

Nothing in that path involves Apple. `src-tauri/macos/bundle.mjs` writes the
bundle and refuses to write one whose usage strings are missing;
`plutil -lint` — Apple's own parser, on the runner — is what says the plist is
well formed; and `codesign --force --sign -` applies an **ad-hoc** signature,
which is local bookkeeping rather than a certificate and is what the kernel asks
of any arm64 binary. There is no Developer ID, no notarisation and no Apple
Developer Program, deliberately: a certificate and a notarisation ticket both
need an account. What is left is the friction that buys: a downloaded copy is
quarantined, so Gatekeeper refuses the first launch and the operator allows it
once under **System Settings → Privacy & Security → Open Anyway**. After that
the prompts come from the bundle, and TCC remembers the answer for that copy of
it — a fresh download is a new signature and may ask again.

The release notes carry exactly that instruction in one paragraph, because the
app's own update prompt shows the first `NOTES_LIMIT` (320) characters of them.
The v0.1.1 run did all of its own part, and the log is the evidence: `bundle.mjs`
reporting the arm64 binary with three usage strings, `plutil -lint` answering
`OK`, `codesign` reporting `Signature=adhoc` on `app bundle with Mach-O thin
(arm64)`, and the zip carrying `Contents/_CodeSignature/CodeResources`. The
artifact that run produced was then downloaded and opened here: its plist parses
with `0.1.1` and all three usage strings, its payload is an arm64 Mach-O, and
`Contents/MacOS/open-telestrator` arrives `0755` — `ditto` keeps the mode that
matters. The other honest half needs a person: **nobody has opened the bundle on
a Mac** and watched TCC put its prompt on screen, which is the one thing this
machine cannot do.

**An Intel macOS build.** `macos-latest` is Apple Silicon, so today's matrix
produces one macOS build for ARM Macs. An Intel build means a second macOS job
with `--target x86_64-apple-darwin` (plus `rustup target add x86_64-apple-darwin`),
or a universal build with `--target universal-apple-darwin`. It is left out
deliberately: a second macOS job doubles the macOS assets without doubling the
people who want them, and the two would need distinct asset names before they
could sit side by side in one release.

**Android — signed with a key of its own, and never by CI.** The APK on the
releases page carries this project's own certificate rather than the Android
debug key, so it installs over an older copy of itself. The keystore deliberately
lives outside the repository and outside Actions: anyone holding it can sign an
APK that upgrades over this one, so the APK is built and signed on a machine that
has it while the three desktop assets come from CI. `keystore.properties` is
gitignored, and `*.jks`/`*.keystore` are ignored in the Android project in case
one is ever generated there. Setting it up is
[docs/android.md](android.md#signing-the-keystore-and-what-is-not-in-the-repository).

## What is left

- **More than one destination at a time.** One publisher at a time, by design:
  a second destination would need a second encoder, and the program is one
  picture. Restreaming to several platforms at once is a different feature.
- **A person at a Windows and a macOS build.** The release workflow makes both,
  and the macOS one now wraps the binary in an `.app` so the permission prompts
  have a bundle to come from — but that machine is a runner, and nobody has sat
  at either build. Windows also warns at SmartScreen until somebody buys a
  code-signing certificate; the macOS bundle stays unsigned because signing it
  means an Apple Developer account. Both are accepted friction rather than
  unfinished code, and both are argued out under *Signing, per platform*.
- **An APK measured on real hardware.** It is built, signed and driven on an
  emulated tablet, and the screen-capture row is now left out where the platform
  has no `getDisplayMedia`. Nobody has held it: a stylus, a palm on the glass and
  a program pushed out to a platform from the phone are the three measurements
  left. [docs/android.md](android.md#what-is-missing) is the list.
- **Capture hardening.** `getDisplayMedia` works on WebView2 and WKWebView (after
  the Screen Recording grant), is unreliable on WebKitGTK, and is absent from
  Android's WebView. If a webview cannot capture, the fallback is Rust-side
  capture feeding a `MediaStreamTrackGenerator`. Not built; the per-platform
  measurement is not done either.
- **A real file dialog for an opened video.** Opening a file still reads it into
  memory through the browser path rather than streaming it from disk through
  Tauri's asset protocol, which is what a large file wants.

## Verified how

- `cargo test -p telestrator-media` — 63 tests, no server: AMF0, FLV, chunk
  framing (both directions, including extended timestamps and a chunk size that
  changes under the reader), URL parsing, timestamp rebasing, and the whole
  handshake and command sequence driven against an in-memory socket.
- **TLS against a real TLS peer.** The encrypted transport is tested against a
  server this test starts on loopback: a certificate authority generated in the
  test, a leaf for `localhost`/`127.0.0.1`, and rustls on the far side speaking
  just enough RTMP to accept a publish. One test drives a complete publish
  through it — handshake, `connect`, `createStream`, `publish`, metadata, both
  sequence headers and frames — and asserts the server saw the commands in order
  and each tag after the header that has to precede it. Another points the same
  client at the same server with the build's real roots and asserts the
  certificate is *refused*, and that nothing was published to it.
- `cargo test --workspace` — 68 tests: the 63 above plus the shell's 5, which
  pin the frame wire format it parses. `cargo test -p open-telestrator` runs the
  shell's own five on their own.
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
- **The shell boots.** The window exists at 1440x900 titled "Open Telestrator"
  and the tray icon is created; the frame measurement is under *The executable
  was built* below. The only thing it logs on the way up is
  libayatana-appindicator's deprecation warning.
- **The web build is unchanged**: seven rail tiles, no Control tile, no Stream out
  section, no emoji, opening on the Input panel.
- **The update rules are unit-tested** (`src/lib/updates.test.ts`, 24 tests):
  which version counts as newer (`0.10.0` beats `0.9.0`, an unreadable tag beats
  nothing), that a pre-release is not an upgrade to the release of the same
  number, that release notes are flattened and cut, that the opt-out survives a
  restart and reads anything unrecognised as "tell me", that a muted operator is
  still answered when they ask, and that a draft, a non-object or a tag that is
  not a version is read as nothing at all. Both endpoints are pinned to this
  repository.
- **The touch rules are unit-tested** (`src/lib/touch.test.ts`, 16 tests): phone
  against tablet against desktop from real user agents, the layout for the
  awkward viewports listed in [docs/android.md](android.md#viewports-nobody-designed-for),
  the rail/panel pairing, stylus pressure, and palm rejection both ways.
- **The executable was built, and run, with no `dist/` on disk.**
  `npm run desktop:build` leaves one file —
  `src-tauri/target/release/open-telestrator`, 6,284,680 bytes (≈6.3 MB) with the
  opener plugin compiled in — and nothing else: no AppImage, no `.deb`, no
  `bundle/` directory at all, no install directory. The earlier bundle cache was
  deleted before that build, so the absence of one afterwards is what the run
  produced rather than what a previous run left behind. Running that file out of
  `target/release`, after `npm run clean` had deleted `dist/`, opens the studio
  at 1440×900 with a tray icon, and a frame captured from the screen measures
  average luma 16 with a maximum of 235 — the app's own background and its text,
  not a blank window. That is the proof the frontend is embedded and the binary
  is genuinely self-contained. What it does not prove is a Windows or a macOS
  build, which this machine cannot make. See *Releasing*.
- **The update prompt was driven in a browser**, with only the shell's IPC
  stubbed: a release payload for `0.2.0` against a running `0.1.0` puts the
  prompt on screen with the version, the current version and the notes read from
  the payload; *Get the new version* calls the opener with the release's own
  `html_url` and nothing else; ticking the opt-out writes
  `open-telestrator.updates.notify=off`, leaves the prompt up (so it can be
  unticked), and silences the next launch; and the tray's event brings the prompt
  back for a muted operator. What that does **not** prove is the API call itself
  — a real request needs the real shell and a published release, and the first
  tag is where that gets proved.
- **The mobile layout was driven in a browser at phone and tablet sizes**, with
  the shell stubbed and the body laid out by the same hook the shell uses: the
  rail moves to the bottom bar, the panel becomes a sheet, the controls grow to
  44px, and the notice is replaced by the studio. Measured at 320×568, 390×844,
  568×320, 820×1180, 1024×600 and 1180×820; the two things the measurements
  changed were the sheet's height (a percentage of an auto-height parent is
  circular) and the rail's tiles, which now shrink to 44px so seven of them fit a
  phone.
- **A stylus and a palm were driven on the real canvas** by dispatching pointer
  events at the component: a pen at pressure 0.9 draws a 10px line where a pen at
  0.1 draws 4px (the configured width is 6), a touch arriving inside the palm
  window after a pen draws nothing at all, and the same touch two seconds later
  draws at the neutral width. That was a browser; the APK itself has since been
  built, signed and driven on an emulated tablet —
  [docs/android.md](android.md) is where the evidence for it is.
- **The macOS bundle was assembled on this machine from a stand-in binary.** The
  real Mach-O is built and wrapped by the runner, which is the point — this box
  cannot make one — but everything around it is exercised here: the script
  refuses a file that is not a Mach-O, writes the tree, and sets the executable
  bit; the resulting `Info.plist` parses under a real plist parser with the
  product name, identifier and version taken from `tauri.conf.json` and all three
  usage strings present; and the bundle survives a zip and unzip with
  `Contents/MacOS/open-telestrator` still `0755`. It also refuses a template
  missing a usage string, which is the mistake that would ship a bundle macOS
  will not ask on behalf of. What the *runner* adds is in the v0.1.1 log, and the
  artifact it produced was checked from here as well — see *Signing, per
  platform*. What is **not** proved anywhere yet is TCC actually granting camera,
  microphone and screen recording on a Mac, which needs somebody with a Mac.
- **The platform presets have not been dialled.** Facebook Live's address comes
  from the list OBS maintains; Instagram's from two independent sources, since
  OBS does not carry it. Without an account on each service there is no way to
  complete a real publish, so these are checked as addresses and as shapes, not
  as live connections.

## Setting it up on a new machine

To *run* a build: nothing at all. The desktop app is one executable — download
it, `chmod +x` on Linux, run it — and there is no server to install, because Rust
opens the RTMP connection itself. On macOS it is an unzipped `.app` you open, and
it needs one allow under Privacy & Security the first time; see *Signing, per
platform*. That is why this design was chosen over bundling a media server and
`ffmpeg`.

To *build* it:

| | needs |
| --- | --- |
| Linux | `libwebkit2gtk-4.1-dev`, `libgtk-3-dev`, `libayatana-appindicator3-dev`, `librsvg2-dev`, `build-essential`, plus Rust (1.77+) |
| Windows | WebView2 (present on Windows 11; otherwise the evergreen runtime from Microsoft), the MSVC toolchain, Rust |
| macOS | Xcode command line tools, Rust |

Then:

```bash
npm install
npm run desktop:build
```

That last one leaves the bare executable. On macOS, wrapping it is a second
command, and worth running before you test the camera or a capture — the prompts
only exist inside the bundle:

```bash
node src-tauri/macos/bundle.mjs --binary src-tauri/target/release/open-telestrator
```

And to go live to a platform:

1. In YouTube Studio, **Create → Go live → Stream**, and copy the **Stream key**.
2. Either ingest address the page shows works — `rtmp://a.rtmp.youtube.com/live2`
   or the encrypted `rtmps://a.rtmp.youtube.com/live2`. Twitch is
   `rtmp://live.twitch.tv/app`. Facebook Live and Instagram are in the picker and
   hand you an encrypted address; LinkedIn Live issues its address per event, so
   paste it into **Something else**.
3. In the studio, open the **Broadcast** panel, pick the platform, paste the key,
   and **Stream out**. The key is kept in the window and never shown in full.

To *release* one: tag it. There is nothing to set up first — no signing key, no
repository secret, no manifest to host. The workflow builds the three platforms
and files a draft release; see *Releasing*.

Three things to know:

- **The global shortcut may be taken.** If `Ctrl/Cmd+Shift+D` is already bound by
  another application, the shell logs it and you come back out of Control mode
  with the tray icon instead.
- **The stream key is sent over the connection as-is.** On a plain `rtmp://`
  ingest that means it crosses the network unencrypted, which is what YouTube and
  Twitch expect on that address; on an `rtmps://` ingest the whole connection is
  under TLS, key included.
- **The first launch may prompt about updates and find nothing.** Until a release
  is published the API answers 404, and the app stays quiet about it. Ticking
  *Do not tell me about new versions* is silent too — nothing is reported until
  there is an answer worth reporting.
