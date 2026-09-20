# ADR-0001: Headless `UltraMediaCore` + thin `<ultra-media>` element shell

- **Status:** Accepted
- **Date:** 2026-09-19
- **Deciders:** Rodrigo França

## Context

`<ultra-media>` today is one class (`src/ultra-media-element.ts`) that extends
Mux's `super-media-element` and mixes three concerns: being a custom element,
orchestrating engines (format detection, player factory, lifecycle,
cancellation, error routing), and adapting tracks to `media-tracks`.

Three forces make that shape untenable:

1. **Host integration.** The first production host (a large publisher player
   with its own kernel, UI and ad stack) creates and owns the `<video>`
   element and hands it to its engines. `<ultra-media>` creates its own
   `<video>` inside a shadow root, so it cannot be plugged in as an engine.
   The host's ad stack (IMA) must operate on the same real `<video>`.
2. **Devices.** Smart TVs (older Tizen/webOS) may lack Custom Elements v1,
   Shadow DOM, `ResizeObserver` or the `EventTarget` constructor. The playback
   logic must run without any of them.
3. **The inherited base is in the way.** `super-media-element` was last
   published in June 2024; Mux continued it as `custom-media-element`
   (same monorepo, actively released). While fixing lifecycle and error
   handling we hit three problems caused by the base sitting in the path of
   core logic: it reserves `load()` for its own convention, it re-dispatches
   every native event with an empty `detail` (duplicate `error`), and its
   `disconnectedCallback` is a no-op. A large part of our public API is
   inherited and was never frozen.

At the same time, **media-chrome compatibility is a strategic goal**
(plug-and-play UI, community adoption, presence in the Mux ecosystem), and the
individual players in `src/players/*` already take an `HTMLVideoElement` as a
constructor argument — the engine layer is closer to headless than the element
suggests.

Measured weight of the core bundle (13.0 kB gzip): own code ≈ 8 kB,
`media-tracks` ≈ 3.5 kB, `super-media-element` ≈ 1.8 kB.

## Decision

Split the package into two layers with a hard dependency rule between them.

```
@rodrigofranca/ultra-media/core   UltraMediaCore      pure class, zero runtime deps,
                                                      no Custom Elements / Shadow DOM
@rodrigofranca/ultra-media        <ultra-media>       thin shell over the core,
                                                      media-chrome compatible
@rodrigofranca/ultra-media/ad     <ultra-media-ad>    unchanged
```

**Rule:** `core` never imports from the shell, from `custom-media-element` or
from `media-tracks`. A build-time check enforces it, like the existing
"core bundle contains no ads code" guard.

### D1 — `UltraMediaCore` attaches to a media element it does not own

```ts
const core = new UltraMediaCore(mediaEl, options);
core.load('https://…/master.m3u8');
// …
core.destroy();            // idempotent; mediaEl is left clean and reusable
```

The core never creates, moves or removes `mediaEl`. It may set `src`,
`crossOrigin` and attach listeners, and must undo all of it on `destroy()`.
Everything that exists today in `ultra-media-element.ts` beyond "being an
element" moves here: format detection, engine selection, the pending-load
cancellation (`destroyed` + generation counter), source-swap teardown, and the
single `fatal ? 'error' : 'warning'` routing.

### D2 — Public surface of the core

```ts
interface UltraMediaOptions {
  container?: HTMLElement;       // where engines that render outside <video> (YouTube) mount
  request?: RequestPolicy;       // D4
  live?: boolean | 'auto';       // D5 — default 'auto'
  sdk?: { hls?: string; dash?: string };   // override pinned CDN URLs (self-host / other CDN)
  preferNative?: boolean | 'auto';         // native HLS where MSE is worse (Safari, TVs)
  retry?: RetryPolicy;           // shape reserved; implemented with `alternatives`
}

type Source = string | { src: string; type?: Format; alternatives?: string[] };

class UltraMediaCore {
  constructor(media: HTMLMediaElement, options?: UltraMediaOptions);
  load(source: Source): void;
  destroy(): void;
  configure(options: Partial<UltraMediaOptions>): void;   // applies to the next load()

  readonly media: HTMLMediaElement;
  readonly src: string | null;
  readonly format: Format | null;
  readonly engine: string | null;          // 'hls.js' | 'dash.js' | 'native' | 'youtube' | custom
  readonly ready: Promise<void>;           // settles per load(); rejects on fatal error / supersede

  readonly renditions: readonly VideoRendition[];
  rendition: string | 'auto';              // get/set by id
  readonly audioTracks: readonly MediaTrack[];
  audioTrack: string | null;
  readonly textTracks: readonly MediaTrack[];   // manifest subtitles, in addition to <track>
  textTrack: string | null;

  readonly live: LiveInfo;                 // D5
  goToLive(): void;

  addEventListener(type, listener): void;
  removeEventListener(type, listener): void;

  static registerEngine(engine: EngineDefinition): void;   // D6
}
```

Events (all carry a typed `detail`): `error`, `warning`, `ready`,
`sourcechange`, `enginechange`, `renditionschange`, `renditionchange`,
`audiotrackschange`, `audiotrackchange`, `texttrackschange`, `texttrackchange`,
`livechange`, `streamended`. Standard media events (`playing`, `timeupdate`…)
are **not** re-emitted: consumers listen on `core.media`, which is the real
element. `error`/`warning` keep today's `MediaPlayerError` shape.

The core exposes an `addEventListener`-compatible surface backed by a ~30-line
internal emitter rather than `extends EventTarget`, because the `EventTarget`
constructor is missing on the oldest TV runtimes.

Selection by **id** everywhere (not index, not height, not language). Hosts
that think in heights or language codes map them in their adapter.

### D3 — The `<ultra-media>` shell is built on Mux's `custom-media-element`

The shell owns a `<video>` in its shadow root, instantiates one
`UltraMediaCore` on it, reflects attributes to options, and mirrors core state
to the APIs media-chrome reads (`videoRenditions` / `audioTracks` via
`media-tracks`, `error`/`warning` re-dispatched as `CustomEvent`).

We **migrate from the frozen `super-media-element` to its maintained
successor `custom-media-element`** instead of writing our own base. With the
core extracted, the base is no longer in the path of playback logic, so its
conventions stop hurting:

- ~~its `load()` hook (called by the base on every `src` change) becomes
  exactly what we need — the shell's `load()` delegates to `core.load()`~~ —
  **Correção pós-implementação (result-cycle2.md):** `custom-media-element`
  has no such hook. `src` is in the shell's own `skipAttributes`, so the
  base's `#forwardAttribute` never touches it; the shell's
  `attributeChangedCallback` intercepts `src` itself and calls
  `core.load()`/`core.destroy()` directly from there (see
  `src/ultra-media-element.ts`). The outcome D3 wanted — one place, driven by
  `src` changes, owning the core's lifecycle — still holds; only the
  mechanism differs from what this ADR originally assumed.
- native-event forwarding is fine for media events; we keep `error` excluded
  and re-dispatch ours;
- connect/disconnect handling stays in the shell (deferred teardown already
  implemented), calling `core.destroy()` / `core.load()`.

This keeps media-chrome compatibility and the Mux-ecosystem story, confines
both Mux dependencies (~5 kB gzip) to the shell, and leaves the core — what
the production host and TVs consume — dependency-free (≈ 8 kB gzip today).

A Playwright e2e using `examples/media-chrome-player.html` becomes a gate:
play/pause, seek, rendition menu and mute through `<media-controller>`.

### D4 — Request policy (auth, signed URLs)

```ts
interface RequestContext { url: string; type: 'manifest' | 'segment' | 'key' | 'license' | 'other' }
interface RequestPolicy {
  headers?: Record<string, string> | ((ctx: RequestContext) => Record<string, string> | void);
  credentials?: 'omit' | 'same-origin' | 'include';
  transformUrl?: (ctx: RequestContext) => string | void;     // signed URLs, CDN switching
}
```

Applied by each engine through its SDK's supported hook (hls.js
`xhrSetup`/`fetchSetup`, dash.js request interceptors). For native playback
the browser issues the requests, so only `credentials` (via `crossOrigin`) and
`transformUrl` on the top-level URL can apply; **custom headers on native
playback are impossible** and the core emits a `warning`
(`code: 'REQUEST_HEADERS_UNSUPPORTED'`) instead of silently dropping them.

This covers the host's "Bearer token, else cookies" rule and the backlog items
"URL signing" and "XHR overwrite".

### D5 — Live

`options.live`: `'auto'` reads it from the manifest; `true` forces live
handling (start at the edge). `core.live` =
`{ isLive, seekableStart, seekableEnd, liveEdge, latency?, playheadDate? }`,
updated with `livechange`. `goToLive()` seeks to the engine's live sync
position. A live stream that ends emits `streamended` (live → VOD transition,
terminal 404 on the manifest, or final stall), which is distinct from `ended`.

### D6 — Engine contract and registration

`IMediaPlayer` evolves into an internal `MediaEngine` contract: constructor
receives `(media, context)` where `context` carries `request`, `live`,
`container`, `sdk` URLs and an abort signal equivalent; it adds
`getLiveInfo()`, `goToLive()`, `setTextTrack()` and standardises the
cancellation semantics that hls/dash/youtube implement separately today.

```ts
UltraMediaCore.registerEngine({
  name: 'shaka',
  canPlay: (source, env) => 0 | 1 | 2,   // 0 = no; higher wins over built-ins
  create: (media, context) => MediaEngine,
});
```

Built-ins register themselves through the same API (backlog item "library
extension"). SDK loading stays lazy and pinned (`sdk-config.ts`).

### D7 — What is explicitly *not* in the core

- The host's `on/off/fire` emitter, `changeBitrate(height)`,
  `changeLanguage(code)`, `initialize(token)`: these are host dialect and live
  in the host's adapter, which wraps `UltraMediaCore`.
- Ads. The host keeps its own ad stack on the shared `<video>`;
  `<ultra-media-ad>` remains a separate entry. A generic ad-plugin contract is
  a later ADR.
- Analytics adapters. The core will expose QoE signals (separate ADR); vendors
  (Permutive, GA, Comscore…) are adapters outside the package.
- DRM (P2 — first production target does not use it). `RequestContext.type`
  already reserves `key`/`license`.

## Consequences

**Positive:** pluggable as an engine in a host-owned `<video>`; runs without
Custom Elements; public API is ours and frozen by types + tests; Mux
dependencies isolated and on a maintained package; core ≈ 8 kB gzip.

**Negative / risks:** the refactor touches every file in `src/`; the element's
inherited API must be inventoried and frozen with tests *before* moving code;
two layers mean state mirrored in two places (tracks), a classic source of
drift — the shell must derive from core events only, never from the SDKs.

**Breaking changes for current consumers:** none intended for `<ultra-media>`
attributes, properties and events. New: `/core` entry. Anything that reached
into `element.player` or other internals breaks (never public).

## Delivery plan

Each step is its own PR with the existing gates (typecheck, 79 unit, 36 e2e,
size) plus a blind review, max three fix cycles.

1. **Freeze the contract.** Inventory the element's effective public API
   (own + inherited) and lock it with tests. No production code changes.
2. **Extract `UltraMediaCore`** with zero behaviour change; the element
   delegates to it. `/core` entry + "core imports no shell/Mux code" guard +
   an e2e that drives the core on a bare `<video>` with no custom element.
3. **Shell on `custom-media-element`** + media-chrome e2e gate.
4. **Request policy** (D4).
5. **Live** (D5).
6. **`alternatives` failover + retry policy.**
7. Host adapter behind a feature flag (host repository, out of this package).

## Status da etapa 3

Concluída. `<ultra-media>` migrou de `super-media-element@1.4.2` para
`custom-media-element@1.4.6`; `media-chrome@4.19.2` (`^4`) foi adicionado
como devDependency e o gate e2e `core/e2e/tests/media-chrome.spec.ts` cobre
play/pause/mute/seek/duration/troca de rendition/troca de src através de um
`<media-controller>` real, servido localmente (hermético). Ver
`fronts/shell-migration/result.md` para o inventário completo de diferenças
de base, mudanças de contrato e tamanhos antes/depois.

## Status da etapa 4 - revisão (ciclo 2)

Uma revisão independente da etapa 4 reprovou a implementação inicial por 6
defeitos, todos corrigidos: (1, bloqueante) `transformUrl` assinava a URL
duas vezes no retry interno do hls.js (`XhrLoader` reaproveitando o mesmo
`context` - dash.js já era seguro, reconstrói a requisição do zero a cada
tentativa); (2) `crossOrigin` não voltava ao valor original no `destroy()`;
(3) `warning`s da política podiam ser emitidos antes de `wireUp()` registrar
o callback da geração certa, ou vazar para a geração seguinte; (4) um
`headers()` que lançava depois de um `transformUrl()` bem-sucedido deixava a
requisição num estado misto; (5) a semântica de `credentials` por engine foi
precisamente documentada (só `'include'` é distinguível na maioria dos
caminhos - ver README.md); (6) licenças DRM continuam fora dos hooks de
`options.request`, registrado e não implementado. Ver
`fronts/request-policy/result-cycle2.md` para evidência vermelho→verde por
defeito, a tabela de `credentials` por engine e os tamanhos antes/depois.

## Status da etapa 4

Implementada (`options.request`/`core.configure()`, headers/credentials/
transformUrl aplicados a hls.js via `xhrSetup`+`fetchSetup`, a dash.js via
`addRequestInterceptor`, e ao nativo/YouTube via `crossOrigin`+URL de
nível superior com `warning REQUEST_HEADERS_UNSUPPORTED`), com um desvio do
sketch original: `RequestContext` ganhou um campo `engine: string` que a
minuta acima (D4) não tinha - necessário para um `headers(ctx)` cobrindo
mais de um engine saber quem está pedindo, sem re-derivar isso de `type`/
`url`. **Bloqueada em `pnpm size`:** o núcleo headless (`/core`, o que o
primeiro host de produção realmente consome - D1) cabe nos seus limites
(11.57/12 kB ESM, 8.47/9 kB UMD), mas a casca `<ultra-media>` excede os
dela em 1.52 kB (ESM) e 243 B (UMD) - ela já estava a 0.06 kB do limite
antes desta etapa, e o mecanismo mínimo de D4 (sem contar a classificação
de `type`) já custa ~1.36 kB gzip só por si. Ver
`fronts/request-policy/result.md` para os números completos e a pergunta
em aberto.

## Status da etapa 5

Implementada por completo e testada (hls.js/dash.js/nativo, `options.live`,
`core.live`/`goToLive()`, eventos `livechange`/`streamended`, atributo
`live`/`isLive`/`liveInfo`/`goToLive()`/`streamType`/`targetLiveWindow`/
`liveEdgeStart` na casca, gate media-chrome de `media-live-button`), com um
fixture de live hermético e determinístico (HLS: janela deslizante
controlada por contagem de recargas; DASH: `SegmentTemplate` de duração fixa
ancorado ao relógio real - ver `fronts/live/result.md` "fixture live" para
por que os dois engines usam mecanismos diferentes, incluindo uma limitação
de dash.js 5.2.1 confirmada empiricamente: não recarregou um MPD dinâmico
sozinho nesta suíte). **Bloqueada em `pnpm size`, nas quatro contagens que
importam:**

- `/core` (D1, o que o primeiro host de produção consome): ESM
  **13.78/13.5 kB** (excede 275 B); UMD 9.69/10 kB (dentro do limite).
- Casca `<ultra-media>`: ESM **20.74/19 kB** (excede 1.74 kB); UMD
  **13.53/13.5 kB** (excede 28 B).
- Ads (não tocado): inalterado.

Mesmo padrão da etapa 4 (`fronts/request-policy/result.md`): a folga
pré-existente (0.38 kB ESM/0.96 kB UMD na casca; 1.28 kB ESM/1.23 kB UMD no
`/core`) era menor que o custo mínimo de D5 mesmo depois de cortes reais
(fallback HLS nativo sem MSE ficou sem live; `latency` não é calculado;
limiar de `dvr` fixo em vez de por-engine) - ver `fronts/live/result.md`
para a pergunta exata e as opções levantadas.

## Open questions

1. Build target for `/core`: which minimum Tizen/webOS years? Until answered,
   the core avoids Custom Elements, Shadow DOM, `EventTarget` construction,
   `ResizeObserver` and private class fields, and we ship ES2017 for `/core`.
2. Native playback + Bearer token (Safari/TV native HLS): is cookie auth or a
   tokenised URL acceptable there? Headers cannot be set.
3. Single package with subpath exports (proposed) vs. a separate
   `@ultra-media/core` package. Subpaths are simpler now; a scope is better
   branding later and can be introduced without breaking imports.
4. Should `renditions`/`audioTracks` in the core also be exposed through
   `media-tracks`-shaped lists for hosts without the shell? Proposed: no.
