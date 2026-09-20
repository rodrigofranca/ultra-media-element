# Ultra Media Element

Web Component moderno para reprodução de vídeos em múltiplos formatos (HLS, MP4, DASH), construído sobre `custom-media-element`, com auto detecção de formato, suporte a build ESM/CDN e compatibilidade com [media-chrome](https://github.com/muxinc/media-chrome).

---

## 🚀 Instalação

### CDN (Recomendado para uso rápido)

```html
<script
  type="module"
  src="https://cdn.jsdelivr.net/npm/@rodrigofranca/ultra-media/+esm"
></script>
```

Depois, use diretamente no HTML:

```html
<ultra-media src="https://example.com/video.m3u8"></ultra-media>
```

> 💡 O Web Component será registrado automaticamente como `<ultra-media>`.

---

### NPM

```bash
npm install @rodrigofranca/ultra-media
```

Depois, no seu projeto:

```ts
import "@rodrigofranca/ultra-media";
```

---

## 📦 Entry points (`<ultra-media>` vs `<ultra-media-ad>`)

O pacote publica **dois entry points independentes**. O núcleo (`<ultra-media>`)
nunca importa código de ads, direta ou transitivamente - quem só toca vídeo
não paga pelo peso do `ima-ad-player`.

| Elemento/API | Entry | ESM | `<script>` (UMD) |
| --- | --- | --- | --- |
| `<ultra-media>` | `@rodrigofranca/ultra-media` | `import "@rodrigofranca/ultra-media"` | `dist/ultra-media.umd.js` |
| `<ultra-media-ad>` | `@rodrigofranca/ultra-media/ad` | `import "@rodrigofranca/ultra-media/ad"` | `dist/ultra-media-ad.umd.js` |
| `UltraMediaCore` (headless, sem Custom Elements) | `@rodrigofranca/ultra-media/core` | `import { UltraMediaCore } from "@rodrigofranca/ultra-media/core"` | `dist/ultra-media-core.umd.js` |

Cada bundle UMD é publicado com dois nomes e o mesmo conteúdo: `*.umd.js` para `<script src>` (CDNs como o jsDelivr servem `.cjs` como `application/node` com `nosniff`, e o browser recusa) e `*.umd.cjs` para `require()` (o pacote é `"type": "module"`).

```ts
// só vídeo
import "@rodrigofranca/ultra-media";

// vídeo + ads (Google IMA via ima-ad-player)
import "@rodrigofranca/ultra-media";
import "@rodrigofranca/ultra-media/ad";
```

```html
<!-- via <script>, sem bundler -->
<script type="module" src="https://cdn.jsdelivr.net/npm/@rodrigofranca/ultra-media/+esm"></script>
<script type="module" src="https://cdn.jsdelivr.net/npm/@rodrigofranca/ultra-media/ad/+esm"></script>
```

`<ultra-media-ad>` depende do núcleo apenas pelo contrato público do elemento
`<ultra-media>` (o `nativeEl` que ele expõe) - nunca importa internals de
`src/core`/`src/players`, então incluir o entry de ads não faz o bundle do
núcleo ser duplicado nem embutido.

> ⚠️ **Breaking change**: antes desta versão, importar
> `@rodrigofranca/ultra-media` registrava `<ultra-media>` **e**
> `<ultra-media-ad>` no mesmo bundle. Quem usa `<ultra-media-ad>` agora
> precisa do import adicional `@rodrigofranca/ultra-media/ad` (ou da tag
> `<script>` equivalente) - ver tabela acima.

---

## 🧠 Headless core (`UltraMediaCore`)

ADR-0001 divide o pacote em duas camadas: `UltraMediaCore` é uma classe pura
(zero dependências de runtime, sem Custom Elements, sem Shadow DOM) que se
anexa a um `<video>`/`<audio>` **que ela não cria e não é dona** - o host
continua controlando o elemento (e pode rodar seu próprio stack de ads sobre
ele). `<ultra-media>` é a casca fina construída em cima dela.

Público-alvo: hosts que já têm seu próprio elemento de mídia (players com
kernel próprio, integrações com ad stacks como IMA que exigem o `<video>`
real) e ambientes sem Custom Elements v1 (Smart TVs mais antigas).

```ts
import { UltraMediaCore } from '@rodrigofranca/ultra-media/core';

const video = document.querySelector('video')!; // seu próprio <video>
const core = new UltraMediaCore(video);

core.addEventListener('error', (e) => console.error(e.detail));
core.addEventListener('renditionschange', (e) => console.log(e.detail.renditions));

core.load('https://example.com/master.m3u8'); // ou { src, type: Format.HLS }
await core.ready; // resolve quando a engine está pronta; rejeita em erro fatal/superação

core.rendition = '1';       // seleção por id, não por índice/altura
core.audioTrack = 'pt-BR';  // idem

core.destroy(); // idempotente; deixa `video` limpo e reutilizável
```

API (implementada nesta extração - ver `docs/public-api.md` e o ADR para o
que ainda não existe: `live`, `sdk`, `preferNative`, `retry`, `textTracks`,
`goToLive()`, `registerEngine()`):

- `new UltraMediaCore(media, { container?, request? })`
- `load(source: string | { src, type? })`, `destroy()` (idempotente)
- `configure({ request? })` - aplica opções à *próxima* `load()`; uma carga
  já em andamento continua com a política que estava ativa quando seu
  `load()` rodou. Ver "Authentication & request policy" abaixo.
- `media`, `src`, `format`, `engine`, `ready` (`Promise<void>`, uma por `load()`)
- `renditions`, `rendition` (get/set por id ou `'auto'`)
- `audioTracks`, `audioTrack` (get/set por id)
- `addEventListener`/`removeEventListener` para `error`, `warning`, `ready`,
  `sourcechange`, `enginechange`, `renditionschange`, `renditionchange`,
  `audiotrackschange`, `audiotrackchange` - eventos simples `{ type, detail }`,
  não `Event`/`CustomEvent` reais (o construtor de `EventTarget` falta nas
  TVs mais antigas visadas).

Regra de dependência (com guarda automática -
`tests/core-dependency-guard.test.ts` + `scripts/check-core-isolation.mjs`,
parte de `pnpm size`): nada sob `src/core-entry.ts` pode importar
`custom-media-element` (a base da casca), `media-tracks` ou a casca, nem
usar Custom Elements, Shadow DOM, `ResizeObserver`, o construtor de
`EventTarget` ou campos privados `#`.

---

## ✅ Suporte a formatos

| Formato | Extensão/URL | Engine Utilizada |
| ------- | -------- | ---------------- |
| HLS     | `.m3u8`  | hls.js           |
| DASH    | `.mpd`   | dash.js          |
| MP4     | `.mp4`   | video nativo     |
| YouTube | `youtube.com` | YouTube IFrame API |

---

## 🔐 Authentication & request policy

ADR-0001 D4. Cobre o caso "Bearer token quando há sessão, senão cookies" e o
backlog de assinatura de URL/troca de CDN. Aplicado por engine, onde
tecnicamente possível - ver a matriz abaixo.

```ts
interface RequestContext {
  url: string;
  type: 'manifest' | 'segment' | 'key' | 'license' | 'other';
  engine: string; // 'hls.js' | 'dash.js' | 'video/mp4' | 'audio/mp3' | 'youtube'
}

interface RequestPolicy {
  headers?: Record<string, string> | ((ctx: RequestContext) => Record<string, string> | void);
  credentials?: 'omit' | 'same-origin' | 'include';
  transformUrl?: (ctx: RequestContext) => string | void;
}
```

```ts
// Núcleo headless
const core = new UltraMediaCore(video, {
  request: {
    headers: (ctx) => (hasToken() ? { Authorization: `Bearer ${getToken()}` } : undefined),
    credentials: hasToken() ? 'omit' : 'include', // sem token -> cookies
  },
});
core.load('https://example.com/master.m3u8');

// Trocar a política (ex.: token renovado) - só vale a partir do PRÓXIMO load()
core.configure({ request: { headers: { Authorization: `Bearer ${newToken}` } } });
core.load('https://example.com/master.m3u8'); // agora sim usa o novo header
```

Na casca `<ultra-media>`, a mesma opção é uma **propriedade** (nunca um
atributo HTML - headers com token não pertencem a markup):

```ts
document.querySelector('ultra-media').request = {
  headers: { Authorization: 'Bearer ...' },
};
```

Semântica: `transformUrl` roda primeiro (a URL final é a que `headers(ctx)`
recebe); `headers` como função é chamada por requisição, permitindo token
rotativo. Um `headers`/`transformUrl` do host que lança uma exceção nunca
derruba a requisição, mas **a política inteira é descartada só para aquela
requisição** (revisão do ciclo 2, defeito 4): ela sai com a URL original, sem
headers e sem `credentials` - nunca um estado misto (ex.: URL já assinada mas
sem o header que autenticaria essa assinatura). Um `warning`
(`code: 'REQUEST_POLICY_ERROR'`) é emitido; a próxima requisição (retry,
próximo segmento) tenta a política de novo, do zero.

`crossOrigin` (nativo/HLS sem MSE) é restaurado no `destroy()` do player que o
aplicou, ao valor de antes (ausente, se o atributo não existia) - ciclo 2,
defeito 2. Um host que mudou `crossOrigin` manualmente depois da nossa
escrita não é sobrescrito de volta (mesmo critério do `style.display` que o
engine YouTube restaura).

Matriz engine × capacidade:

| Engine | `headers` | `credentials` | `transformUrl` | `RequestContext.type` |
| --- | --- | --- | --- | --- |
| hls.js | ✅ via `xhrSetup`/`fetchSetup` (cobre os dois loaders) | ✅ (`include` → `xhr.withCredentials`/`fetch` `credentials`) | ✅ - idempotente mesmo nos retries internos do hls.js (ciclo 2, defeito 1) | `manifest`/`level`/`audioTrack`/`subtitleTrack`/`steering-manifest` → `manifest`; `media-fragment` → `segment`; `key` → `key`; resto → `other` |
| dash.js | ✅ via `addRequestInterceptor` | ✅ (mesmos valores de `RequestCredentials`, setados direto na `CommonMediaRequest`) | ✅ - já era idempotente nos retries (dash.js reconstrói a requisição do zero a cada tentativa) | `MPD` → `manifest`; `*Segment` → `segment`; `license`/`licenseCertificate` → reservado, não aplicado (ver nota DRM abaixo); resto → `other` |
| Nativo (MP4/MP3, HLS sem MSE) | ❌ impossível - `warning` (`REQUEST_HEADERS_UNSUPPORTED`) emitido uma vez por carga, playback continua | ✅ via `crossOrigin` (`include` → `'use-credentials'`; `omit`/`same-origin` → `'anonymous'`) | ✅ na URL de nível superior (`manifest` para HLS nativo, `other` para MP4/MP3) | fixo (só a URL de nível superior existe) |
| YouTube | ❌ impossível - mesmo `warning` | ⚠️ ignorado (documentado aqui, sem `warning` - não há requisição de mídia nossa para aplicar) | ⚠️ ignorado, mesma razão | `other` |

**Semântica exata de `credentials` por engine (ciclo 2, defeito 5)** - os
três valores (`'omit'`, `'same-origin'`, `'include'`) só são realmente
distintos onde a Fetch API decide as credenciais; onde a decisão passa por
`XMLHttpRequest.withCredentials` (um booleano) ou pelo atributo `crossOrigin`
do `<video>`/`<audio>` (que só distingue CORS-sem-credenciais de
CORS-com-credenciais), **`'omit'` e `'same-origin'` produzem exatamente o
mesmo comportamento observável**, porque nenhuma das duas Web Platform APIs
tem um modo "nunca envie cookies, nem same-origin":

| Engine | Caminho real | `'omit'`/`'same-origin'` | `'include'` |
| --- | --- | --- | --- |
| hls.js (`xhrSetup`, o loader padrão) | `xhr.withCredentials` | idênticos - `withCredentials: false` | `withCredentials: true` |
| hls.js (`fetchSetup`, só se o host configurar `config.loader`/FetchLoader) | `fetch()`'s `credentials` | **distintos** - `'omit'` nunca envia cookies, nem same-origin | `'include'` |
| dash.js (loader padrão, XHR - `_getLoader` só escolhe fetch para segmentos de baixa latência que este pacote não usa) | `xhr.withCredentials` | idênticos, mesma razão do hls.js | `withCredentials: true` |
| Nativo (MP4/MP3, HLS sem MSE) | `crossOrigin` | idênticos - ambos viram `'anonymous'` | `'use-credentials'` |

Ou seja: na prática, com os loaders padrão de cada engine, `'omit'` só é
realmente "omitir" se o host trocar hls.js para seu `FetchLoader` via
`config.loader` - fora isso, é indistinguível de `'same-origin'` em todo
lugar. O tipo (`RequestPolicy.credentials`) documenta isso via JSDoc.

**DRM/licenças (ciclo 2, defeito 6, registrado - não implementado):** hls.js
aplica requisições de licença por um hook separado
(`config.licenseXhrSetup`) e dash.js por outro (`registerLicenseRequestFilter`/
`licenseRequestFilters`, consumido em `_doLicenseRequest`) - nenhum dos dois
passa pelos hooks (`xhrSetup`/`fetchSetup`/`addRequestInterceptor`) que
`options.request` usa hoje. `RequestContext.type` já reserva `'license'`
para quando essa etapa (DRM, P2) for implementada, mas **nenhuma licença
recebe `headers`/`credentials`/`transformUrl` atualmente** - `dash.js`'s
`classifyDashRequestType` até classifica `'license'`/`'licenseCertificate'`
quando o tipo aparece, mas isso nunca acontece na prática porque
`addRequestInterceptor` nunca é chamado para uma requisição de licença.

---

## 🎛️ Uso com media-chrome

`<ultra-media>` é compatível com [media-chrome](https://github.com/muxinc/media-chrome) plug-and-play — basta usar o atributo `slot="media"` dentro de um `<media-controller>`:

```html
<script type="module" src="https://cdn.jsdelivr.net/npm/@rodrigofranca/ultra-media/+esm"></script>
<script type="module" src="https://cdn.jsdelivr.net/npm/media-chrome@4/+esm"></script>

<media-controller>
  <ultra-media slot="media" src="https://example.com/master.m3u8"></ultra-media>
  <media-control-bar>
    <media-play-button></media-play-button>
    <media-mute-button></media-mute-button>
    <media-time-range></media-time-range>
    <media-time-display showduration></media-time-display>
    <media-rendition-menu-button invoketarget="rendition-menu"></media-rendition-menu-button>
  </media-control-bar>
  <media-rendition-menu id="rendition-menu" hidden anchor="auto"></media-rendition-menu>
</media-controller>
```

Funciona porque a casca mantém `videoRenditions`/`audioTracks` (via `media-tracks`) sincronizados com o núcleo — os controles de media-chrome leem essas listas diretamente, sem nenhum código extra. Veja `examples/media-chrome-player.html` para um exemplo completo e `core/e2e/tests/media-chrome.spec.ts` para o gate e2e (play/pause/mute/seek/duração/troca de rendition/troca de `src`, tudo através de um `<media-controller>` real).

---

## 🔄 Ciclo de vida

- `destroy()` — público e idempotente. Destrói o player ativo (hls.js/dash.js/YouTube/nativo) e libera seus recursos. O elemento continua reutilizável: atribuir `src` novamente depois de `destroy()` inicializa um player novo e volta a tocar.
- Remover o elemento do DOM (`disconnectedCallback`) libera os recursos automaticamente. Mover o elemento no DOM (uma desconexão seguida de reconexão síncrona, comum em frameworks) **não** interrompe a reprodução - o teardown real só ocorre se o elemento permanecer fora do DOM além do fim do turno síncrono atual. Ao reconectar depois de um teardown efetivo, o `src` atual é recarregado automaticamente.

```ts
const player = document.querySelector('ultra-media');
player.destroy();          // libera hls.js/dash.js/YouTube/nativo
player.setAttribute('src', '...'); // volta a tocar
```

## ⚠️ Eventos de erro

O elemento dispara dois eventos de erro, ambos `CustomEvent` com o mesmo shape de `detail`:

- **`error`** — só para falhas **fatais** (reprodução não continua sem intervenção): manifesto/segmento inicial 404, MediaSource inválido, etc.
- **`warning`** — para falhas **recuperáveis** (a engine tenta de novo e a reprodução segue): um segmento intermediário que falha uma vez e é recarregado com sucesso, por exemplo.

```ts
interface MediaPlayerError {
  fatal: boolean;
  category: 'networkError' | 'mediaError' | 'otherError';
  code: string;      // código específico da engine (ex.: "fragLoadError", "25")
  message: string;
  engine: string;     // "hls.js" | "dash.js" | "video/mp4" | "audio/mp3" | "youtube"
  url?: string;
  status?: number;    // HTTP status, quando disponível (não é exposto pelos players nativos)
  cause?: unknown;     // erro/objeto original da engine, para debug
}

player.addEventListener('error', (e) => console.error(e.detail));
player.addEventListener('warning', (e) => console.warn(e.detail));
```

---

## 📦 Build local (para desenvolvimento)

```bash
npm install
npm run dev
```

Acesse:

```bash
https://dev.fantascope.uol.com.br
```

---

## 🔌 Uso com SvelteKit (SSR)

Este Web Component usa APIs de browser (DOM, `customElements`, `ResizeObserver`) que não existem em Node.js. Para uso com SSR, importe dinamicamente em `onMount`:

```svelte
<script>
  import { onMount } from 'svelte';

  onMount(async () => {
    await import('@rodrigofranca/ultra-media');
  });
</script>

<ultra-media src="https://example.com/video.m3u8"></ultra-media>
```

---

## 🔧 Scripts disponíveis

| Script            | Descrição                        |
| ----------------- | -------------------------------- |
| `npm run dev`     | Servidor local com HTTPS e HMR   |
| `npm run build`   | Build para `dist/` com ESM + UMD |
| `npm run preview` | Preview local pós build          |

---

## 🧠 IntelliSense no VSCode (HTML & TypeScript)

### Para autocomplete do componente `<ultra-media>` no HTML:

```json
// .vscode/settings.json
{
  "html.customData": ["./node_modules/@rodrigofranca/ultra-media/vscode.html-data.json"]
}
```

### Para reconhecimento do tipo no TypeScript:

```json
// tsconfig.json
{
  "compilerOptions": {
    "types": ["@rodrigofranca/ultra-media"]
  }
}
```

Depois, você poderá fazer:

```ts
const player = document.querySelector("ultra-media");
player?.changeSource?.("...");
player?.getCurrentFormat?.();
```

---

## 📄 Licença

MIT

---

## ✨ Créditos

Construído sobre [custom-media-element](https://github.com/muxinc/media-elements/tree/main/packages/custom-media-element) (Mux), sucessor mantido do [super-media-element](https://github.com/luwes/super-media-element) original.
