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

| Formato | Extensão | Engine Utilizada |
| ------- | -------- | ---------------- |
| HLS     | `.m3u8`  | hls.js           |
| DASH    | `.mpd`   | dash.js          |
| MP4     | `.mp4`   | video nativo     |

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
