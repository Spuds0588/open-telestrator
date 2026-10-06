# Agent notes for open-telestrator

Free & open-source sports telestrator and P2P broadcasting studio. React + Vite +
TypeScript, no backend: the static bundle deploys to GitHub Pages and all
transport is PeerJS/WebRTC.

## Clean up between jobs

The dev environment is memory-constrained. Finish every job by leaving it as you
found it, and say in your summary what you cleaned.

1. **Stop the servers you started.** A dev or preview server costs roughly
   90–180 MB and keeps holding it until something kills it. Before finishing,
   check and kill what you own:

   ```bash
   ss -ltn 2>/dev/null | grep -E '4173|5173'   # what is listening
   kill <pid>                                  # the npm wrapper *and* the node child
   ```

   Never leave one running "in case I need it again". Never start a second one on
   the same port; look first and reuse it if it is already there.
2. **Remove build output and caches:**

   ```bash
   npm run clean   # dist, dev-dist, coverage, *.tsbuildinfo, Vite/Vitest caches, Gradle output
   ```

   `dist/` is a build artifact and is regenerable — do not treat it as a
   deliverable to keep, and never commit it.
3. **Delete one-off scratch work.** Probe scripts, captured screenshots, log
   dumps, temporary fixtures and half-written notes go as soon as they have
   answered the question. The repo should contain only files the project needs.
4. **Do not leave unused dependencies.** Check before installing anything, and
   remove anything nothing imports — an unused package costs install time, disk
   and audit surface forever. Verify first:

   ```bash
   grep -rn "from '<pkg>'" src          # is it used at all?
   npm ls <pkg>                          # who depends on it?
   npm uninstall <pkg>                   # then re-run test + build
   ```

   The `peer` package was once installed by mistake alongside the real library,
   `peerjs`. Nothing imported it.
5. **Keep `.gitignore` honest.** If you generate a new kind of artifact, ignore
   it in the same change so the next agent does not have to think about it.
6. **Do not commit build output or generated files** — the deploy workflow
   builds from source, so committing `dist/` would only rot.

## Commands

```bash
npm run dev        # dev server (http://localhost:5173)
npm test           # Vitest, run once (247 tests)
npm run typecheck  # tsc --noEmit
npm run build      # typecheck + production build (also emits the service worker)
npm run preview    # serve the production build
npm run clean      # remove build output and caches (leaves src-tauri/target alone)
```

The Rust half of the desktop build has its own commands. The publisher is a
member crate on purpose, so its tests run without Tauri's dependency tree
anywhere near them:

```bash
npm run desktop            # the shell, with hot reload in the webview
npm run desktop:build      # the standalone executable for this platform
node src-tauri/macos/bundle.mjs --binary <path>   # macOS only: the .app the release ships
npm run android            # the phone build, on a device (needs the SDK; docs/android.md)
npm run android:build      # the APK and the AAB
cargo build                # in src-tauri/
cargo test --workspace     # both members: 63 media tests, 5 shell tests
cargo test -p telestrator-media     # AMF0, FLV, chunk framing, RTMP, TLS
cargo test -p open-telestrator      # the frame wire format the shell parses
```

`npm run build` runs the typecheck first, and `.github/workflows/deploy-pages.yml`
runs the tests before building, so a failing test blocks the deploy to prod. The
workflow does not build the desktop app, so a Rust change is only as verified as
what you ran locally. `.github/workflows/desktop-release.yml` does build it, on
all three platforms at once, but only from a `v*` tag — `v0.1.0` was its first
run, and all three jobs produced their asset. It labels the Windows and macOS
assets `-beta` and still files only a **draft**: publishing is the one step left
to a person.

## Conventions

- **Pure logic goes in `src/lib/*.ts` with a sibling `*.test.ts`.** React glue
  (hooks, `use*` modules) and components stay thin. Anything that broke once —
  source merging, camera links, stroke geometry, replay rotation, error
  classification, peer config, the broadcast protocol, compositor geometry,
  media-feed classification, hardware mappings, shared-drawing operations — has
  unit tests; keep it that way when you change those paths.
- **The stage is the program.** While broadcasting, `useProgramCompositor`
  redraws the stage — video, live corner, corner camera, strokes — into the one
  canvas stream viewers receive, so drawings and overlays are on air. Draw
  strokes into it with `drawStroke`, never `renderStrokes`: that helper clears
  its canvas first and would wipe the video frame underneath. The corner boxes
  exist twice on purpose — `cornerBox` in `src/lib/composite.ts` and
  `.screen__corner` in `index.css` — keep their geometry in step.
- **A media element cannot be a long-lived source via `captureStream()`**: its
  track is removed for good the moment a file ends. Opened files and streams are
  therefore re-drawn onto a canvas (`useMediaFeeds`), which also keeps the last
  frame on screen. Their audio is routed through the mixer as a media-element
  source, not through the capture.
- **Shared drawing has one writer: the host.** The cameraman link is also the
  co-host link, and sharing the camera is optional on that page (a co-host that
  only draws connects on the data channel alone). Camera media stays one-way, but
  the host additionally calls a co-host back with the *raw* program source so it
  has something to draw on —
  never the composite, which already has the strokes burned in. Both sides trade
  validated operations over the link's data channel (`src/lib/collab.ts`); the
  host applies each one to the stack the compositor puts on air and forwards it
  to the other co-hosts (the sender already has it), and a co-host never
  forwards. Applying an operation is idempotent per stroke id, which is what
  makes that safe. Both canvases must stay 16:9 so a stroke lands in the same
  place on each.
- **One error classifier per concern, shared.** `classifyCameraError` and its
  friends live in `src/lib/mediaErrors.ts` and are used by both the host and the
  cameraman page; do not fork a copy.
- `tsconfig.json` is strict with `noUnusedLocals`/`noUnusedParameters`, so dead
  code and unused imports fail the build. Keep it that way rather than
  suppressing.
- **No UI framework and no CSS modules.** Everything is in `src/index.css` with
  semantic class names (`.panel`, `.rail`, `.feed-card`). Delete
  rules you orphan instead of leaving them.
- **The controls are a rail plus one panel.** `src/lib/panels.ts` owns the roster
  and the badge each closed panel shows; `src/components/Sidebar.tsx` renders the
  rail and whichever panel is open. There is no panel per app concern: the corner
  camera (the picture-in-picture) belongs to the **Input** panel with the other
  source controls. Rail tiles and the co-host's drawing tools are sized for a
  stylus and a fingertip — keep new controls at least 40px on their short side
  rather than shrinking them to fit.
- **Icons are Lucide outlines, never emoji**, mapped per concern in
  `src/components/icons.tsx` and stroked in `currentColor` so the control's own
  colour drives them. Importing a named icon is the only way to reach one: the
  barrel is tree-shaken, so the rest of the set never reaches the bundle.
  Sizing lives in `index.css` (`.chip svg`, `.icon-btn svg`, `.rail__icon`), so a
  new control inherits it instead of setting its own width.
- **The web app is desktop-only; the *shell* is not.** A phone or tablet in a
  browser still gets the unsupported notice pointing at GitHub releases, and the
  cameraman (`?camera=`) and viewer (`?watch=`) entries — code-split in
  `src/main.tsx` — must keep working there. Inside the Android shell (see
  [docs/android.md](docs/android.md)) that notice is replaced by the studio, and
  only there: `body.desktop` is what swaps them, and a shell sets it for any
  narrow window, which is also what keeps a desktop window resized below 1024
  from inviting the operator to download what they are already running.
- **Touch and stylus rules live in `src/lib/touch.ts`, with tests.** Form factor,
  the rail-against-sheet layout, pressure on a stroke and palm rejection are all
  decided there and asked for by the components; the CSS hangs off
  `body[data-layout]` and `body.touch`, which only `useLayout` sets. New controls
  aim for `MIN_TARGET` (44px) on the short side — the floor of 40 is the worst
  case, not the target.
- **The shell is a library with a two-line binary.** `src-tauri/src/lib.rs` holds
  `run()`, because Android needs `mobile_entry_point` on a function its activity
  can call; `main.rs` only calls it. Everything a phone cannot use — the tray, the
  global shortcut, the whole of Control mode — is `#[cfg(desktop)]`,
  so one shell serves both without a second copy of anything. That cfg has to
  cover what those pieces *use* as well as the pieces themselves: an import or a
  `const` left outside it is dead code on Android, and
  `cargo check --target aarch64-linux-android` is what says so.
- **`src-tauri/gen/android` is committed source, not a cache.** `tauri android
  init` writes it once and it is edited like anything else — and it does need
  editing: the generator does not add the camera and microphone permissions, and
  without them `getUserMedia` is refused before a dialog can appear. Its own
  `.gitignore` files already exclude the Gradle output, the copied `jniLibs` and
  the generated `tauri.conf.json`, so `git status` stays honest; a real keystore
  belongs in `keystore.properties`, which is ignored too.
- **Two pages, one build.** `index.html` is the static landing page — its own
  `src/home.css`, no app bundle, and copy written for search and answer engines.
  `app.html` is the studio and serves every other entry; it is `noindex`. Every
  link the app mints (viewer, cameraman, QR) resolves against `app.html`, never
  the directory root. The landing page's visible FAQ and its JSON-LD are one
  artefact: change them together, and keep `public/robots.txt`,
  `public/sitemap.xml` and `public/llms.txt` on the real URLs.
- **A viewer page in somebody else's page goes bare.** The viewer drops this
  app's chrome when it is framed or linked from another origin (`wantsEmbed` in
  `src/lib/broadcast.ts`), so an embed needs no URL parameter; the `embed`
  parameter stays as an explicit override. Keep that logic in the lib with its
  tests rather than reading `window` in the component.
- **Click-through "Control" mode belongs to the Tauri build, not this one**, where
  the canvas always draws and never passes input to the page underneath. The
  desktop build has it: one window made to ignore cursor events
  (`src/lib/controlMode.ts` for the rules, `src-tauri/src/control.rs` for the
  window call), with the global shortcut, the tray icon and the rail's own switch
  as the ways back out. It is deliberately **one** window, not two — the stroke
  stack, the display capture and the broadcast all live in one webview, and
  splitting them across windows would fork the strokes. Streaming the program out
  to an RTMP platform is the shell's other addition. See
  [docs/tauri-desktop.md](docs/tauri-desktop.md).
- **Nothing outside `src/lib/desktop.ts` may ask whether we are in the shell.**
  Every other module asks it, so the browser keeps behaving identically and its
  tests keep proving it. `@tauri-apps/api` is imported lazily inside it, so the
  Pages bundle never carries the shell's API.
- **The desktop-only rail tile comes from `desktopPanels(controlMode)`**, never
  from mutating `PANELS`. `panels.test.ts` proves the two rosters differ only by
  Control at the head, so the web build keeps its seven tiles and a phone build —
  which has no second window to pass a click to — gets the same seven.
- **The updater is opt-out, and the opt-out is not a one-way door.** Rules in
  `src/lib/updates.ts` with tests: the preference lives under
  `open-telestrator.updates.notify`, an unreadable value means "tell me", and
  `shouldPrompt` lets a check the operator asked for through even when
  announcements are off — that is the way back, from the tray. A check that finds
  nothing, or cannot reach GitHub, says nothing. The release body is what the
  prompt shows, flattened and cut at `NOTES_LIMIT` (320) characters, so the
  workflow writes the notes as one paragraph that fits — a truncated sentence is
  the one place an operator reads the instruction they need.
- **The desktop app is one standalone executable, and there is no installer on
  any platform.** `bundle.active` is `false`, so `tauri build` leaves
  `src-tauri/target/release/open-telestrator` and no AppImage, `.deb`, MSI or
  `.dmg`; there is no signing key to generate or lose, and no `latest.json` to
  host. That is a deliberate trade, not an omission: nothing installs itself, so
  a newer version is *news and a link* — the GitHub API's `releases/latest`, with
  the release page handed to the system's browser through the opener plugin,
  whose capability allows that one address and nothing else. A phone is left out
  of the check on purpose (a release carries desktop binaries and an APK would
  come from a store), which is why `useUpdates` asks `shellMode()` rather than
  `isDesktop()`.
- **The macOS download is a hand-assembled `.app`, not a Tauri bundle.** macOS
  only asks for camera, microphone and screen-recording permission on behalf of a
  bundle with the right `Info.plist` strings, and a bare executable is a Mac build
  that can neither see nor hear — so `src-tauri/macos/bundle.mjs` writes the
  bundle from the built binary, `src-tauri/macos/Info.plist` and `icons/icon.icns`,
  filling the product name, identifier and version in from `tauri.conf.json`, and
  the release workflow lints it with `plutil`, signs it **ad-hoc** (`codesign
  --sign -`, no certificate and no Apple account, ever) and zips it with `ditto`.
  The script refuses to write a bundle whose usage strings are gone — that
  failure is invisible until a Mac user hits it. `bundle.active` stays `false`:
  this is packaging the same standalone binary, not installing it.
- **`src-tauri/media` has exactly one dependency, on purpose.** The RTMP
  publisher is hand-rolled — AMF0, FLV tag bodies, chunk framing — so its 63 tests
  run in a few seconds with no server and no network. TLS is the exception and
  could not be hand-rolled: `rustls` + `webpki-roots`, with `ring` as the crypto
  provider, are what reach the `rtmps://` ingest that Facebook Live and Instagram
  publish and nothing else. `src/tls.rs` makes that argument in the file; any
  *other* crate needs the same before it lands.
- **The frame wire format lives in two places**: `src/lib/frameHeader.ts` writes it
  and `src-tauri/src/stream.rs` reads it, each pinned by its own tests. Change one
  and the other fails — that is the point, so keep both in step.
- **Encoded frames cross the IPC boundary, never pixels.** A 1080p RGBA frame is
  megabytes before it is compressed and kilobytes after. Anything that would put
  raw frames on that boundary needs shared memory, not a bigger call.
- **`src-tauri/target` is a Rust build cache, not a deliverable** — gitignored,
  and left alone by `npm run clean` because deleting it costs a two-minute
  rebuild. `cargo clean` is there if disk matters more.
- Broadcasting is deliberately live-only: no catch-up, no synchronisation between
  viewers. A steady picture per viewer is the goal, so keep the self-healing
  paths (host sweep, viewer rejoin) intact. The *program* may contain replays
  and overlays, but viewers still join at the live edge — do not add buffering.
- Match the existing style: 2-space indent, no semicolons, single quotes,
  functional components, British-ish spelling in user-facing copy ("colour").
- Do not commit, push, or open a PR unless asked to.
