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
   npm run clean   # dist, dev-dist, coverage, *.tsbuildinfo, Vite/Vitest caches
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
npm test           # Vitest, run once (104 tests)
npm run typecheck  # tsc --noEmit
npm run build      # typecheck + production build (also emits the service worker)
npm run preview    # serve the production build
npm run clean      # remove build output and caches
```

`npm run build` runs the typecheck first, and `.github/workflows/deploy-pages.yml`
runs the tests before building, so a failing test blocks the deploy to prod.

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
  semantic class names (`.side-group`, `.feed-card`, `.viewer__bar`). Delete
  rules you orphan instead of leaving them.
- **The web app is desktop-only.** Phones and tablets get the unsupported notice
  pointing at GitHub releases. The cameraman (`?camera=`) and viewer (`?watch=`)
  entries live on the studio page (`app.html`) and are code-split in
  `src/main.tsx`; they must keep working on phones.
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
  the canvas always draws and never passes input to the page underneath.
- Broadcasting is deliberately live-only: no catch-up, no synchronisation between
  viewers. A steady picture per viewer is the goal, so keep the self-healing
  paths (host sweep, viewer rejoin) intact. The *program* may contain replays
  and overlays, but viewers still join at the live edge — do not add buffering.
- Match the existing style: 2-space indent, no semicolons, single quotes,
  functional components, British-ish spelling in user-facing copy ("colour").
- Do not commit, push, or open a PR unless asked to.
