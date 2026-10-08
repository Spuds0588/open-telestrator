# Agent notes for open-telestrator

Free & open-source sports telestrator and P2P broadcasting studio. React + Vite +
TypeScript, no backend: the static bundle deploys to GitHub Pages and all
transport is WebRTC — PeerJS for the viewer tree and the cameraman link, WHIP for
publishing the program out to a live platform. There are no native shells any
more, on any platform, and nothing to download: the page is the app.

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
   npm run clean   # dist, dev-dist, coverage, *.tsbuildinfo, Vite/Vitest caches
   ```

   `dist/` is a build artifact and regenerable — do not treat it as a
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
npm test           # Vitest, run once (212 tests)
npm run typecheck  # tsc --noEmit
npm run build      # typecheck + production build (also emits the service worker)
npm run preview    # serve the production build
npm run clean      # remove build output and caches
```

`npm run dev` serves the landing page at `/` and the studio at `/app.html`.

`npm run build` runs the typecheck first, and `.github/workflows/deploy-pages.yml`
runs the tests before building, so a failing test blocks the deploy to prod. That
workflow is the only one left: it is a static front end and there is no binary to
release.

There is **no phone build and no desktop build** to run. One bundle is every
entry, and the phone layout is a viewport decision inside it — shrink a browser
window, or open one with device emulation on, and you are looking at the same
code a phone gets.

## Conventions

- **Pure logic goes in `src/lib/*.ts` with a sibling `*.test.ts`.** React glue
  (hooks, `use*` modules) and components stay thin. Anything that broke once —
  source merging, camera links, stroke geometry, replay rotation, error
  classification, peer config, the broadcast protocol, compositor geometry,
  media-feed classification, hardware mappings, shared-drawing operations, the
  WHIP request shapes — has unit tests; keep it that way when you change those
  paths.
- **The stage is the program.** While broadcasting, `useProgramCompositor`
  redraws the stage — video, live corner, the two corner cameras, strokes — into
  the one canvas stream viewers receive, so drawings and overlays are on air.
  Draw strokes into it with `drawStroke`, never `renderStrokes`: that helper
  clears its canvas first and would wipe the video frame underneath. The corner
  boxes exist twice on purpose — `cornerBox` in `src/lib/composite.ts` and
  `.screen__corner` in `index.css` — keep their geometry in step. There are two
  camera boxes, one per bottom corner (`OVERLAY_CORNERS`), because two
  pictures-in-picture can be on air at once: which source sits in which box is a
  record with its rules (**an input is in one box at a time**; a box empties when
  its source goes or becomes the program) kept pure in that same module with its
  tests, not spread over the components. The live corner keeps the top-right.
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
  cameras (the picture-in-pictures) belong to the **Input** panel with the other
  source controls, one select per box. Rail tiles and the co-host's drawing tools
  are sized for a stylus and a fingertip — keep new controls at least 40px on
  their short side rather than shrinking them to fit.
- **The phone link has one session and two doors, and the door is the role.**
  The cameraman link and the co-host link are the same link — one peer, one token,
  minted once (`useHostCamera.createLink`) — and the only difference is the `role`
  parameter on the URL handed out (`src/lib/cameraLink.ts`). The **Co-hosts** panel
  hands out the co-host link: draw on the program, camera and mic optional. The
  **Add input** picker hands out `role=camera` (`add-input-phone-camera`): a camera
  and a microphone and nothing else, because a host looks for a second camera under
  inputs. **Only the host draws**, so a camera link is never sent the program or the
  stroke stack, and the phone page refuses a program call outright. The role is an
  intention, not a permission — the token is what the host checks — and a link that
  says nothing is a co-host link, which is every link minted before the roles
  existed. Never fork a second peer, token or dialog for it.
- **Icons are Lucide outlines, never emoji**, mapped per concern in
  `src/components/icons.tsx` and stroked in `currentColor` so the control's own
  colour drives them. Importing a named icon is the only way to reach one: the
  barrel is tree-shaken, so the rest of the set never reaches the bundle.
  Sizing lives in `index.css` (`.chip svg`, `.icon-btn svg`, `.rail__icon`), so a
  new control inherits it instead of setting its own width.
- **Supporting phones is a viewport decision, not a second build.** There is no
  unsupported-device notice and no `body.desktop`: the cameraman (`?camera=`) and
  viewer (`?watch=`) entries — code-split in `src/main.tsx` — were always reachable
  on any device, and the studio now is too. A control the platform cannot honour is
  still not drawn: the Add input picker offers its screen/tab row only where
  `getDisplayMedia` exists (`canShareScreen` in `src/lib/capture.ts`), so a phone
  that cannot share its screen never shows a button that can only fail. The rule is
  the capability, not the device. The phone page (`?camera=`) asks for the
  microphone along with the camera: a phone on the far side of the ground is a
  commentator's camera and voice, and the host's mixer takes whatever audio the
  program source carries.
- **Touch and stylus rules live in `src/lib/touch.ts`, with tests.** Form factor,
  the rail-against-sheet layout, pressure on a stroke and palm rejection are all
  decided there and asked for by the components; the CSS hangs off
  `body[data-layout]` and `body.touch`, which only `useLayout` sets.
  `layoutFor` always returns a layout — there is no shell to defer to — and a user
  agent that says nothing is taken for a desktop, so a narrow mouse-driven window
  keeps its side rail. New controls aim for `MIN_TARGET` (44px) on the short side —
  the floor of 40 is the worst case, not the target.
- **A held device's rail is a wrapped grid, not a bar.** Seven tiles across a
  390px phone is 49px each, which is a target thumbs miss, so
  `body[data-layout='compact'] .rail` is a grid of `minmax(88px, 1fr)` columns
  that wraps — four across a portrait phone, and in landscape exactly seven in one
  row, because a phone on its side has the width and not the height. Tiles are
  taller there (`.rail__item` min-height 68) and the glyph and label are sized for
  a fingertip in `body.touch`. Do not put the zero-width-scrollbar bar back: a
  hidden scroll region is how the Co-hosts tile went missing on a phone.
- **Landscape is the shape asked for, once.** `shouldSuggestLandscape` (in
  `src/lib/touch.ts`, with tests) says a phone held upright is worth interrupting;
  `src/components/OrientationPrompt.tsx` is the full-screen note it drives, and
  the session-scoped dismissal is the operator's answer. A tablet in portrait and
  any window are left alone. Keep the decision in the lib: the component only
  reads `body` and storage.
- **Stream-out is WHIP, and it is all in `src/lib/whip.ts`.** The program leaves as
  one `POST` of an SDP offer (`Content-Type: application/sdp`) to a service that
  accepts WebRTC and forwards; the answer comes back in the body with a `Location`
  header, and stopping is a `DELETE` of that resource (RFC 9725). `WHIP_SERVICES`
  is the table of the three routes — Restream is the default because it is the one
  that reaches YouTube and Twitch and takes WHIP on a free plan. Nothing here may
  assume a cross-origin `POST` will be allowed: the service has to permit it, and
  a refusal is reported rather than retried forever. `whipPost` and `whipDelete`
  are the only two functions that touch the network and both take the `fetch` to
  use, which is what keeps the rest testable without a connection.
- **The publish URL is a credential.** For Restream and Cloudflare the secret is
  part of the address, so it is masked on screen and never logged; a bearer token,
  where a service wants one, is treated the same way. Do not put either in a
  build-time variable or a URL parameter.
- **Not everything is reachable.** A platform's own ingest speaks RTMP, which a
  browser cannot open a socket for, so stream-out only works through a forwarding
  service; RTSP and RTMP as *inputs* cannot be played in a browser at all and are
  refused with a notice (`src/lib/mediaFeeds.ts`). Say both plainly rather than
  implying the app can dial a platform directly.
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
- **The service worker updates itself, and the two options that make that work
  are easy to lose.** A stale bundle is the failure that costs the most time to
  diagnose, because everything looks right and nothing runs. `registerSW` in
  `src/main.tsx` registers the worker in production and reloads on activation, but
  it only ever gets as far as "activation" because `vite.config.ts` sets
  `workbox.skipWaiting` and `workbox.clientsClaim` **explicitly**: the plugin
  applies those on its own only when it injects the registration
  (`injectRegister: 'auto'`), and this build registers from the app instead. With
  them missing, a new worker installs and waits — nothing sends it
  `SKIP_WAITING` — so an installed studio keeps the bundle it opened, which on a
  phone can be days. The PWA is never `disable`d and the base path is always
  `VITE_BASE_PATH ?? '/'`. This is the one thing to check by building twice and
  watching a live page swap itself, not by reading the source.
- Broadcasting is deliberately live-only: no catch-up, no synchronisation between
  viewers. A steady picture per viewer is the goal, so keep the self-healing
  paths (host sweep, viewer rejoin) intact. The *program* may contain replays
  and overlays, but viewers still join at the live edge — do not add buffering.
- Match the existing style: 2-space indent, no semicolons, single quotes,
  functional components, British-ish spelling in user-facing copy ("colour").
- Do not commit, push, or open a PR unless asked to.
