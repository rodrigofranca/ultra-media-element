# CLAUDE.md

## Overview
**Ultra Media Element** is a drop-in `<video>`-compatible custom element that auto-detects and plays HLS, DASH, MP4, audio, and YouTube — with plugin support for DRM, ads, and analytics.

## General Instructions

### Planning Mode
- When asked to plan, produce only markdown outlines — no TypeScript, no file edits, no code blocks
- Plans go in `docs/plan/` as markdown files with date prefix (`MM-DD-YY-topic.md`)

### Language
- Code, comments, variable names, commit messages: English
- Logs e mensagens de warn/error visíveis ao dev: English (prefixado com `[Ultra Media Element]`)

---

## 1. Architecture & Package Layout

```
ultra-media-element/
└── core/                         ← all dev happens here (run commands from core/)
    ├── src/
    │   ├── index.ts              ← entry point: registers <ultra-media> and <ultra-media-ad>
    │   ├── ultra-media-element.ts ← main custom element (extends SuperVideoElement + MediaTracksMixin)
    │   ├── ultra-media-ad.ts     ← Google IMA ad component (Shadow DOM)
    │   ├── core/
    │   │   ├── format.ts         ← Format enum (HLS, DASH, MP4, AUDIO, YOUTUBE)
    │   │   ├── format-detector.ts ← URL → Format detection (extension + domain matching)
    │   │   ├── media-player.ts   ← IMediaPlayer interface + MediaTracks types
    │   │   ├── player-factory.ts ← Factory: Format → engine → player instance
    │   │   └── plugin-system.ts  ← PluginManager + IPlugin/IPluginContext interfaces
    │   ├── players/              ← one file per format, each implements IMediaPlayer
    │   │   ├── hls-player.ts     ← hls.js (loaded dynamically from CDN)
    │   │   ├── dash-player.ts    ← dash.js (loaded dynamically from CDN)
    │   │   ├── video-player.ts   ← native <video>
    │   │   ├── audio-player.ts   ← native <audio>
    │   │   └── youtube-player.ts ← YouTube IFrame API (proxy pattern over HTMLMediaElement)
    │   ├── plugins/              ← IPlugin implementations
    │   │   ├── drm-plugin.ts     ← Widevine + PlayReady DRM
    │   │   └── analytics-plugin.ts ← event tracking prototype
    │   └── utils/                ← internal helpers (NOT exported in dist)
    ├── tests/                    ← Jest + jsdom test files
    ├── dev-tools/                ← enhanced dev page (scripts, styles, media-samples.json)
    ├── examples/                 ← 14 standalone HTML demos
    ├── types/                    ← global.d.ts (Svelte/JSX) + youtube.d.ts
    └── docs/                     ← evaluation, implementation plans, tasks.md
```

**Dependency flow:** `UltraMediaElement → PlayerFactory → detectFormat() → Player(HLS|DASH|Video|Audio|YouTube)`
**Plugin flow:** `UltraMediaElement.pluginManager → Player.notifyHls*/notifyDash* → IPlugin hooks`

### Base Classes (external — do NOT modify)
- **`super-media-element`** → `SuperVideoElement`: provides the `<video>`-compatible custom element shell. Handles `nativeEl`, `loadComplete`, `isLoaded`, `attributeChangedCallback` delegation. Extend behavior via overrides in `UltraMediaElement`, never patch the dependency.
- **`media-tracks`** → `MediaTracksMixin`: adds `audioTracks`, `videoTracks`, `videoRenditions` APIs. Use its `addAudioTrack()`, `addVideoTrack()`, `removeAudioTrack()` methods — never reimplement track management.
- If you need behavior these base classes don't provide, extend in `UltraMediaElement` or create a new mixin. Never fork or monkey-patch the npm packages.

### Shadow DOM Policy
- **`<ultra-media>`** does **NOT** use Shadow DOM — it relies on `super-media-element`'s light DOM approach with a slotted `<video>` element
- **`<ultra-media-ad>`** uses **Shadow DOM** (encapsulated ad overlay)
- New components: default to **no Shadow DOM** unless encapsulation is explicitly needed (e.g., ad overlays, isolated UI). When in doubt, follow `<ultra-media>`'s pattern

---

## 2. Development Commands

**All commands run from `core/` directory.**

```bash
cd core
pnpm install                        # install dependencies
pnpm dev                            # dev server (HTTPS + HMR via mkcert)
pnpm build                          # build ESM + UMD to dist/
pnpm watch                          # build in watch mode
pnpm test                           # run all Jest tests
pnpm test -- format-detector.test.ts  # run single test file
pnpm preview                        # preview built library
pnpm analyze                        # generate Custom Elements Manifest
pnpm serve:examples                 # serve examples/ with livereload
```

**TypeScript check (no script configured):**
```bash
npx tsc --noEmit                    # typecheck without emitting
```

---

## 3. Dev Workflow

1. Make changes in `core/src/`
2. Typecheck: `npx tsc --noEmit`
3. Run relevant test: `pnpm test -- <file>.test.ts` (prefer single test over full suite)
4. Build: `pnpm build` (must pass — ESM + UMD + .d.ts)
5. Verify in browser: `pnpm dev` and test with dev-tools page or examples/

When adding a new player or plugin, always verify with a real stream from `dev-tools/data/media-samples.json`.

---

## 4. Code Rules

### Design Patterns
- Always favor established design patterns when implementing new features. This project already uses:
  - **Factory** (`PlayerFactory`) — object creation based on runtime input
  - **Strategy** (`IMediaPlayer` interface) — interchangeable player implementations
  - **Observer** (plugin notification hooks, track change callbacks) — decoupled event communication
  - **Proxy** (`YouTubePlayer`) — wrapping a foreign API behind a native interface
  - **Mixin** (`MediaTracksMixin`) — composing behavior into the main element
- When adding new functionality, identify which pattern fits before writing code. Prefer a known pattern over ad-hoc logic — it keeps the codebase predictable and extensible.
- If no standard pattern applies, keep the solution simple and document the reasoning.

### Modules & Imports
- ES modules only (`import/export`), never CommonJS (`require`)
- Destructure imports: `import { Format } from './core/format'`
- Type-only imports: `import type { IMediaPlayer } from './core/media-player'`
- Internal utils are NOT exported in the public API (excluded in vite.config.ts dts)

### Naming Conventions
- **Files:** kebab-case (`hls-player.ts`, `format-detector.ts`)
- **Classes:** PascalCase (`HlsPlayer`, `PlayerFactory`, `PluginManager`)
- **Interfaces:** `I` prefix — project convention (`IMediaPlayer`, `IPlugin`, `IPluginContext`). Always use `I` prefix for interfaces to distinguish from types and classes.
- **Types:** PascalCase without prefix (`MediaTracks`, `PlayerFactoryProps`, `AvailableFormats`)
- **Enums:** PascalCase name, UPPER_CASE values (`Format.HLS`, `Format.DASH`)
- **Functions:** camelCase (`detectFormat`, `loadSDK`, `isUndefined`)
- **Private fields:** `private` keyword (no `_` prefix)
- **Constants:** camelCase for maps/objects (`colors`, `engines`), UPPER_CASE for true constants (`DEFAULT_FORMATS`)

### Player Pattern (IMediaPlayer)
Every player must implement `IMediaPlayer`:
```typescript
interface IMediaPlayer {
  onReady: Promise<void>;   // resolves when engine is loaded and ready
  load(src: string): void;  // load/switch source
  destroy(): void;          // cleanup engine instance, set to null
  onTracksChange?(callback: (tracks: MediaTracks) => void): void;
  switchAudioTrack?(trackId: string): void;
  switchRendition?(renditionId: string): void;
}
```
- Constructor receives `(element: HTMLVideoElement, pluginManager?: PluginManager)`
- SDK loading is async in `setup()`, resolved via `onReady` promise
- SDKs are loaded dynamically from CDN via `loadSDK()` — never bundled
- `destroy()` must null out engine references (`this.hls = null`, `this.player = null`)

### Plugin Pattern (IPlugin)
- Plugins are registered via `element.registerPlugin(plugin, config?)`
- Plugin hooks are optional — use `plugin.onHlsConfig?.()` pattern
- Config precedence: `media.drm` (per-video) > global config (on register)
- Plugins must not throw — wrap notification calls in try-catch (TODO: enforce this)

### Logging
- Use `log()` and `debug()` from `utils/log.ts` — never raw `console.log` in source
- `console.warn` allowed for validation failures, prefixed with `[Ultra Media Element]`
- `console.error` allowed for fatal errors only
- `debug()` is gated by `?debug` query param

### Custom Element Registration
- Check `globalThis.customElements.get(tag)` before `define()` to avoid duplicate registration
- Element tag names: `ultra-media`, `ultra-media-ad`

### Anti-Patterns
- **Never bundle hls.js, dash.js, or YouTube API** — they are loaded on demand via `loadSDK()`
- **Never import from `utils/` in public API exports** — utils are internal only
- **Never use `any` without justification** — prefer explicit types or generics
- **Never add event listeners without a cleanup path** in `destroy()` or `disconnectedCallback()`
- **Never assume nativeEl exists** — always guard with `if (!this.nativeEl)` checks
- **Never create new custom elements without the registration guard** in `index.ts`

---

## 5. Commit Conventions

Format: `<type>: <description in lowercase>`

| Type | Usage |
|------|-------|
| `feat` | New feature or capability |
| `fix` | Bug fix |
| `chore` | Build, config, dependencies, cleanup |
| `docs` | Documentation only |
| `data` | Test data, media samples |
| `refactor` | Code restructure without behavior change |
| `test` | Adding or updating tests |

No scopes currently enforced. Keep subject line under 72 chars.

---

## 6. Build Output

`pnpm build` generates the following in `core/dist/`:

```
dist/
├── ultra-media.es.js       ← ESM bundle (primary, used by "exports" and "module" in package.json)
├── ultra-media.umd.js      ← UMD bundle (used by "main" in package.json)
├── ultra-media.es.js.map   ← source maps
├── ultra-media.umd.js.map
├── index.d.ts              ← TypeScript declarations (public API only)
└── core/                   ← declaration files for core/ types
```

**What gets published to npm** (defined in `package.json` `files` field):
- `dist/` — built bundles + declarations
- `types/` — `global.d.ts` (Svelte/JSX support) + `youtube.d.ts`
- `vscode.html-data.json` — VSCode IntelliSense

**Entry points:**
- ESM: `dist/ultra-media.es.js` (via `exports["."].import` and `module`)
- UMD: `dist/ultra-media.umd.js` (via `main`)
- Types: `types/global.d.ts`

**Critical:** `utils/` and `players/` are excluded from `.d.ts` generation (see `dts.exclude` in `vite.config.ts`). Never add them to the public API surface.

---

## 7. Testing Conventions

- **Location:** `core/tests/`
- **Naming:** `<module-name>.test.ts` (matches source file kebab-case)
- **Framework:** Jest + ts-jest + jsdom environment
- **Config:** `core/jest.config.cjs`
- **Run single:** `pnpm test -- format-detector.test.ts`
- **Run all:** `pnpm test`

Test structure follows the pattern:
```typescript
import { describe, it, expect } from '@jest/globals';

describe('ModuleName', () => {
  it('should do specific thing', () => {
    // arrange → act → assert
  });
});
```

Mock external SDKs (hls.js, dash.js, YouTube API) — never hit real CDNs in tests. Use `jest.fn()` for callbacks and event handlers.
