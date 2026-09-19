# AGENTS.md

Shared instructions for any coding agent (Claude Code, Codex, opencode, ...)
working in this repository. `@rodrigofranca/ultra-media` (`<ultra-media>`) is
a UI-less web component with automatic media format detection (HLS, DASH,
MP4, MP3, YouTube), headed for a high-traffic production portal with several
agents developing in parallel. Treat the rules below as required, not
optional.

## Project structure

All development happens in `core/`. Run every command from there.

- `src/ultra-media-element.ts` — main `<ultra-media>` custom element
- `src/core/player-factory.ts` — picks a player from the detected format
- `src/core/format-detector.ts` — URL → format detection
- `src/core/media-player.ts` — `IMediaPlayer` interface all players implement
- `src/core/sdk-config.ts` — pinned versions/URLs for dynamically loaded SDKs
- `src/players/` — one class per format (Hls, Dash, Video, Audio, YouTube)
- `src/ultra-media-ad.ts` — `<ultra-media-ad>`, wraps `ima-ad-player`
- `tests/` — Jest + jsdom, one `*.test.ts` per area under test

## Commands

```
cd core
pnpm install --frozen-lockfile   # always use the lockfile; never bump ranges by hand
pnpm typecheck                   # tsc --noEmit
pnpm build                       # vite build -> dist/ (ESM + UMD)
pnpm test                        # jest
pnpm size                        # size-limit, gzip budget on dist/*.js
pnpm dev                         # local dev server (HTTPS + HMR)
```

Before considering any change done, run:

```
pnpm typecheck && pnpm test && pnpm size
```

All three must exit 0. CI (`.github/workflows/ci.yml`) runs the same
sequence plus `pnpm build` on every PR and push to `main`.

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
   just to make it pass.
4. **No new playback features or behavior changes** (retry, live, DRM,
   events, public API) without an explicit task asking for them. If you
   spot one while working on something else, note it instead of fixing it
   inline.
5. **Small, conventional commits.** One logical change per commit
   (`feat:`, `fix:`, `chore:`, `test:`, ...).
6. Don't hand-edit `dist/`, `pnpm-lock.yaml`, or `pnpm-workspace.yaml`;
   regenerate them via `pnpm install`/`pnpm build`.
