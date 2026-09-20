# AGENTS.md

Shared instructions for any coding agent (Claude Code, Codex, opencode, ...)
working in this repository. `@rodrigofranca/ultra-media` (`<ultra-media>`) is
a UI-less web component with automatic media format detection (HLS, DASH,
MP4, MP3, YouTube), headed for a high-traffic production portal with several
agents developing in parallel. Treat the rules below as required, not
optional.

## Project structure

All development happens in `core/`. Run every command from there.

**Layers (ADR-0001):** `UltraMediaCore` (headless engine, zero runtime deps)
→ `<ultra-media>` (thin shell, owns the `<video>`, delegates to one core
instance) → `<ultra-media-ad>` (separate entry, talks to the shell only
through its public contract). Each layer only depends on the one before it,
never the other way around.

- `src/index.ts` — element entry point (`@rodrigofranca/ultra-media`),
  registers **only** `<ultra-media>`. Never import anything from
  `src/ultra-media-ad.ts` here, directly or transitively — that's what keeps
  ads out of this bundle (see `scripts/check-bundle-isolation.mjs`, run by
  `pnpm size`).
- `src/ad.ts` — ad entry point (`@rodrigofranca/ultra-media/ad`), registers
  **only** `<ultra-media-ad>`. Pulls in `ima-ad-player`.
- `src/core-entry.ts` — headless core entry point
  (`@rodrigofranca/ultra-media/core`), exports **only** `UltraMediaCore` and
  its types. **Dependency rule, enforced by
  `tests/core-dependency-guard.test.ts` (source-level import-graph walk) and
  `scripts/check-core-isolation.mjs` (built-bundle content check, run by
  `pnpm size`):** nothing this entry's import graph pulls in may import
  `custom-media-element` (the shell's base class, ADR-0001 D3),
  `media-tracks`, or `src/ultra-media-element.ts`/`src/ultra-media-ad.ts`,
  or use `customElements`, `attachShadow`,
  `ResizeObserver`, `new EventTarget()`, or `#` private class fields — the
  Smart TV runtimes this targets may lack all of those (ADR-0001, open
  question 1). Don't weaken either guard to make a change pass.
- `src/ultra-media-element.ts` — the `<ultra-media>` shell: owns the
  `<video>` (via `custom-media-element`, Mux's maintained successor to the
  frozen `super-media-element` - ADR-0001 D3), instantiates one
  `UltraMediaCore` on it, reflects `src`, mirrors the core's
  `renditions`/`audioTracks` onto the `media-tracks` lists media-chrome
  reads, and re-dispatches the core's `error`/`warning` events as
  `CustomEvent`s. **Golden rule: the shell derives all state from the
  core's events/properties, never from the SDKs or `nativeEl` internals
  directly** - if you need a new piece of playback state in the shell, add
  it to the core first.
- `src/core/ultra-media-core.ts` — `UltraMediaCore`: format detection,
  engine selection (via `player-factory.ts`), source-swap teardown, the
  generation-based `ready`-promise/cancellation bookkeeping, and the single
  fatal→`error`/else→`warning` routing. See `docs/public-api.md` and
  `README.md` "Headless core" for its public surface.
- `src/core/player-factory.ts` — picks a player from the detected (or
  explicitly given) format
- `src/core/format-detector.ts` — URL → format detection
- `src/core/media-player.ts` — `IMediaPlayer` interface all players implement,
  plus the `MediaPlayerError` shape every engine's `onError` reports (see
  README.md "Eventos de erro")
- `src/core/sdk-config.ts` — pinned versions/URLs for dynamically loaded SDKs
- `src/players/` — one class per format (Hls, Dash, Video, Audio, YouTube),
  plus `native-media-error.ts` (shared MediaError → MediaPlayerError mapping
  for the two native-<video>/<audio>-backed players). Imported by
  `UltraMediaCore` — must keep satisfying the dependency rule above (e.g.
  `youtube-player.ts` mounts its iframe via a plain `container.appendChild`,
  never `container.shadowRoot`).
- `src/ultra-media-ad.ts` — `<ultra-media-ad>`, wraps `ima-ad-player`. Talks to
  the shell only through its public contract (`nativeEl`, DOM
  attributes/events) — never imports `src/core`/`src/players` internals, so
  it can be published as a separate bundle without embedding the core.
- `tests/` — Jest + jsdom, one `*.test.ts` per area under test
- `e2e/` — Playwright, real-browser playback against the built `dist/`
  (see `e2e/fixtures/generate.mjs` for the synthetic MP4/HLS/DASH/MP3
  fixtures, `e2e/tests/*.spec.ts` for the specs,
  `e2e/tests/entrypoints.spec.ts` for the element/ads bundle-isolation guard,
  and `e2e/tests/headless-core.spec.ts` for the core-only guard — a bare
  `<video>` with no custom element registered, driven directly through
  `UltraMediaCore`)

## Commands

```
cd core
pnpm install --frozen-lockfile   # always use the lockfile; never bump ranges by hand
pnpm typecheck                   # tsc --noEmit
pnpm build                       # vite build, three times (element, then ad, then headless-core entry) -> dist/ (ESM + UMD each)
pnpm test                        # jest
pnpm size                        # bundle-isolation guard + size-limit, gzip budget on dist/*.js
pnpm dev                         # local dev server (HTTPS + HMR)
pnpm e2e                         # Playwright, hermetic (no external network), builds dist/ first
pnpm e2e:network                 # Playwright, @network specs only (YouTube) - not part of the CI gate
```

Before considering any change done, run:

```
pnpm typecheck && pnpm test && pnpm size
```

All three must exit 0. CI (`.github/workflows/ci.yml`) runs the same
sequence plus `pnpm build` on every PR and push to `main`, and a separate
`e2e` job runs `pnpm build && pnpm e2e`.

## Golden rules

1. **Never load a runtime dependency from `@latest` or any other unpinned
   CDN tag.** Every dynamically-loaded SDK URL/version lives in
   `src/core/sdk-config.ts`. `tests/sdk-config.test.ts` fails the build if
   `@latest` reappears anywhere in `src/`. If Google's IMA SDK or the
   YouTube IFrame API loader ever gain a versioned URL, pin them there too;
   today neither offers one (documented in that file).
2. **Every player implements `IMediaPlayer`** (`src/core/media-player.ts`).
   Keep `onReady` resolving to `void` — nothing downstream should depend on
   what it resolves with.
3. **A test accompanies any behavior change.** If a test and the code
   disagree, read the code and `git log` to find which one is actually
   correct before touching either — don't delete or weaken an assertion
   just to make it pass. **Any change to playback behavior** (loading,
   play/pause/seek, track/rendition exposure, error surfacing, cleanup) also
   needs an `e2e/tests/*.spec.ts` update or addition — the Jest suite mocks
   everything and cannot catch a regression a real browser would hit.
4. **No new playback features or behavior changes** (retry, live, DRM,
   events, public API) without an explicit task asking for them. If you
   spot one while working on something else, note it instead of fixing it
   inline.
5. **Small, conventional commits.** One logical change per commit
   (`feat:`, `fix:`, `chore:`, `test:`, ...).
6. Don't hand-edit `dist/`, `pnpm-lock.yaml`, or `pnpm-workspace.yaml`;
   regenerate them via `pnpm install`/`pnpm build`.
7. **The core entry (`src/index.ts` → `@rodrigofranca/ultra-media`) never
   imports ad code.** `<ultra-media-ad>` (`src/ultra-media-ad.ts`) is
   published as the separate `@rodrigofranca/ultra-media/ad` entry
   (`src/ad.ts`) so `ima-ad-player` never lands in the core bundle. This is
   enforced by `scripts/check-bundle-isolation.mjs` (part of `pnpm size`)
   and by `e2e/tests/entrypoints.spec.ts`; don't weaken either to make a
   change pass. See README.md "Entry points" for the consumer-facing API.
