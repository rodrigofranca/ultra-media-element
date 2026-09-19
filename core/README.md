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
