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
npm test           # Vitest, run once (57 tests)
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
  classification, peer config, the broadcast protocol — has unit tests; keep it
  that way when you change those paths.
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
  entries are code-split in `src/main.tsx` and must keep working on phones.
- **Click-through "Control" mode belongs to the Tauri build, not this one**, where
  the canvas always draws and never passes input to the page underneath.
- Broadcasting is deliberately live-only: no catch-up, no synchronisation between
  viewers. A steady picture per viewer is the goal, so keep the self-healing
  paths (host sweep, viewer rejoin) intact.
- Match the existing style: 2-space indent, no semicolons, single quotes,
  functional components, British-ish spelling in user-facing copy ("colour").
- Do not commit, push, or open a PR unless asked to.
