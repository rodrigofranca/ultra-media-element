# Ultra Media Element

Web Component moderno para reprodução de vídeos em múltiplos formatos (HLS, MP4, DASH), construído sobre `super-media-element`, com auto detecção de formato e suporte a build ESM/CDN.

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

| Elemento/API | Entry | ESM | UMD/`<script>` |
| --- | --- | --- | --- |
| `<ultra-media>` | `@rodrigofranca/ultra-media` | `import "@rodrigofranca/ultra-media"` | `dist/ultra-media.umd.cjs` |
| `<ultra-media-ad>` | `@rodrigofranca/ultra-media/ad` | `import "@rodrigofranca/ultra-media/ad"` | `dist/ultra-media-ad.umd.cjs` |
| `UltraMediaCore` (headless, sem Custom Elements) | `@rodrigofranca/ultra-media/core` | `import { UltraMediaCore } from "@rodrigofranca/ultra-media/core"` | `dist/ultra-media-core.umd.cjs` |

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
que ainda não existe: `request`, `live`, `sdk`, `preferNative`, `retry`,
`configure()`, `textTracks`, `goToLive()`, `registerEngine()`):

- `new UltraMediaCore(media, { container? })`
- `load(source: string | { src, type? })`, `destroy()` (idempotente)
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
`super-media-element`, `media-tracks` ou a casca, nem usar Custom Elements,
Shadow DOM, `ResizeObserver`, o construtor de `EventTarget` ou campos
privados `#`.

---

## ✅ Suporte a formatos

| Formato | Extensão/URL | Engine Utilizada |
| ------- | -------- | ---------------- |
| HLS     | `.m3u8`  | hls.js           |
| DASH    | `.mpd`   | dash.js          |
| MP4     | `.mp4`   | video nativo     |
| YouTube | `youtube.com` | YouTube IFrame API |

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

Inspirado em [super-media-element](https://github.com/luwes/super-media-element).
