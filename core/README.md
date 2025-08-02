# Ultra Media Element

Web Component moderno para reprodução de vídeos em múltiplos formatos (HLS, MP4, DASH), construído sobre `super-media-element`, com auto detecção de formato e suporte a build ESM/CDN.

---

## 🚀 Instalação

### CDN (Recomendado para uso rápido)

```html
<script
  type="module"
  src="https://cdn.jsdelivr.net/npm/ultra-media@4/+esm"
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
npm install ultra-media
```

Depois, no seu projeto:

```ts
import "ultra-media";
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
  "html.customData": ["./node_modules/ultra-media/vscode.html-data.json"]
}
```

### Para reconhecimento do tipo no TypeScript:

```json
// tsconfig.json
{
  "compilerOptions": {
    "types": ["ultra-media"]
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
