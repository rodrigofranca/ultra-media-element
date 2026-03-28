# Análise Competitiva: Ultra Media Element vs Video.js 10

> Data da análise: 2026-03-11
> Cenário: Ultra Media com todos os pontos de atenção resolvidos (testes, CI/CD, error handling, FairPlay, docs)

---

## Arquitetura — Filosofias Opostas

| Aspecto | Ultra Media | Video.js 10 |
|---------|------------|-------------|
| **Filosofia** | Simplicidade — 1 componente, 1 tag, funciona | Composabilidade máxima — slices, stores, selectors, mixins, controllers |
| **Camadas** | `<ultra-media>` → PlayerFactory → Player específico | utils → element → store → core → html/react |
| **Estado** | Delegado ao elemento nativo (SuperVideoElement) | Store reativo próprio com slices independentes |
| **Extensão** | Plugin system clássico (IPlugin + PluginManager) | Composição funcional (features + slices) |
| **Web Components** | Nativo, é a essência do projeto | Uma das saídas — também tem React e React Native |

Abordagens opostas. Ultra Media aposta em **convenção sobre configuração**. Video.js 10 aposta em **flexibilidade máxima**. Servem públicos diferentes.

---

## DX (Developer Experience)

| Aspecto | Ultra Media | Video.js 10 |
|---------|------------|-------------|
| **Time to first play** | `<ultra-media src="video.m3u8">` — 1 linha | createPlayer → features → ProviderMixin → define element — ~10 linhas |
| **Curva de aprendizado** | Baixa — é um `<video>` turbinado | Alta — slices, selectors, contexts, controllers, mixins |
| **Formatos** | 5 (HLS, DASH, MP4, MP3, YouTube) em 1 tag | HLS (SPF próprio + hls.js fallback), nativo |
| **Carregamento** | Dinâmico sob demanda (hls.js, dash.js) | SPF embutido + hls.js como fallback |
| **YouTube** | Suporte nativo com proxy completo da API | Não mencionado |

Ultra Media vence em simplicidade de adoção. Para o dev que quer "colocar um vídeo na página", é incomparavelmente mais direto.

---

## Plugin vs Feature — A Diferença Fundamental

| Aspecto | Ultra Media Plugin | Video.js 10 Feature |
|---------|-------------------|---------------------|
| **Modelo mental** | "Instale e configure" | "Construa a integração" |
| **Quem faz o trabalho** | O plugin (código pronto) | O dev (composição funcional) |
| **API** | `new DrmPlugin({ config })` | `definePlayerFeature({ state, attach })` |
| **Curva** | Ler docs do plugin | Entender slices + store + lifecycle |
| **Resultado** | Igual | Igual |

Isso é a diferença entre **biblioteca** e **framework**. O Video.js 10 te dá os blocos. O Ultra Media te dá a solução montada.

---

## DRM — Exemplo Real de DX

### Ultra Media

```html
<ultra-media
  src="https://stream.example/video.mpd"
  drm-widevine-url="https://license.example/widevine"
  drm-fairplay-url="https://license.example/fairplay"
>
</ultra-media>
```

Ou via plugin:

```js
const player = document.querySelector('ultra-media');
player.registerPlugin(new DrmPlugin({
  widevine: { url: 'https://license.example/widevine' },
  fairplay: { url: 'https://license.example/fairplay', cert: '...' }
}));
```

### Video.js 10

```js
const drmFeature = definePlayerFeature({
  state: ({ target }) => ({ drmState: 'idle' }),
  attach: ({ set, signal }) => {
    // implementar EME manualmente
    // configurar MediaKeySystemAccess
    // gerenciar sessões de licença
    // tratar erros por DRM vendor
  }
});

const { ProviderMixin } = createPlayer({
  features: [...videoFeatures, drmFeature]
});
```

O Video.js 10 **não tem DRM built-in**. O dev precisa criar a feature do zero.

---

## Cenário Enterprise Completo — Lado a Lado

Plataforma de streaming que precisa: DRM, analytics (GA), ads (IMA), bookmark de progresso, cuepoints para chapters, métricas de QoS e multi-audio.

### Ultra Media (~30 linhas do integrador)

```html
<ultra-media src="https://cdn.example/movie.m3u8">
  <track kind="subtitles" src="subs-pt.vtt" srclang="pt" label="Português">
  <track kind="chapters" src="chapters.vtt" srclang="en" label="Chapters">
</ultra-media>

<script>
const player = document.querySelector('ultra-media');

player.registerPlugin(new DrmPlugin({
  widevine: { url: LICENSE_URL },
  fairplay: { url: LICENSE_URL, cert: CERT_URL }
}));

player.registerPlugin(new AnalyticsPlugin({
  provider: 'ga4',
  trackingId: 'G-XXXXXXX',
  events: ['play', 'pause', 'ended', 'quality-change', 'error']
}));

player.registerPlugin(new AdsPlugin({
  ima: { adTagUrl: VMAP_URL }
}));

player.registerPlugin(new BookmarkPlugin({
  storage: 'api',
  endpoint: '/api/progress',
  interval: 10
}));

player.registerPlugin(new CuepointPlugin({
  src: 'chapters.vtt',
  onCue: (cue) => showChapterUI(cue)
}));

player.registerPlugin(new QoSPlugin({
  endpoint: '/api/metrics',
  metrics: ['startup-time', 'rebuffer', 'bitrate', 'dropped-frames']
}));
</script>
```

### Video.js 10 (~800-1000+ linhas do integrador)

O integrador precisa:

1. Criar `drmFeature` com EME completo (~150-300 linhas)
2. Criar `analyticsFeature` com listeners de evento + GA4 SDK (~100 linhas)
3. Integrar IMA SDK como feature customizada (~200 linhas)
4. Criar `bookmarkFeature` com throttle + API calls (~80 linhas)
5. Criar `cuepointFeature` com VTT parsing + events (~100 linhas)
6. Criar `qosFeature` com coleta de métricas MSE (~120 linhas)
7. Compor tudo:

```js
const { ProviderMixin } = createPlayer({
  features: [
    ...videoFeatures,
    drmFeature,
    analyticsFeature,
    adsFeature,
    bookmarkFeature,
    cuepointFeature,
    qosFeature
  ]
});
```

---

## Tabela Competitiva — Features Enterprise

| Necessidade Enterprise | Ultra Media | Video.js 10 |
|----------------------|------------|-------------|
| DRM (Widevine + FairPlay + PlayReady) | **Plugin pronto** | DIY |
| Analytics (GA4, Segment, custom) | **Plugin pronto** | DIY |
| Ads (IMA, VAST, VMAP) | **Plugin pronto** | DIY |
| Bookmark / Resume | **Plugin pronto** | DIY |
| Cuepoints / Chapters | **Plugin pronto** | DIY |
| QoS / Métricas de playback | **Plugin pronto** | DIY |
| Multi-audio track | **Built-in** | Built-in (slice) |
| Quality selection | **Built-in** | Built-in (slice) |
| Subtitles | **Built-in** | Built-in (slice) |
| Skins/UI customizado | Via media-chrome | **Built-in (48 CSS files)** |
| React hooks nativos | Não (Web Component) | **Sim** |
| State management reativo | Não (DOM nativo) | **Sim (store + selectors)** |

---

## Escala e Ecossistema

| Aspecto | Ultra Media (projetado) | Video.js 10 |
|---------|------------------------|-------------|
| **Time** | 1 pessoa | 5+ engenheiros dedicados |
| **Commits em 2025** | — | 684 |
| **Total de PRs** | — | 888+ |
| **Testes** | Corrigidos, escopo menor | 166 arquivos de teste |
| **Docs** | Bilíngue, exemplos, API reference | Multi-framework, 72 blog posts, 50 how-to guides, API gerada |
| **CI/CD** | Implementado | release-please, commitlint, bundle-size automatizado |
| **Marca** | Nova, desconhecida | "Video.js" — nome lendário |
| **Skins** | Depende de media-chrome | Sistema próprio com 48 arquivos CSS |
| **React** | Via Web Components | Pacote dedicado com hooks nativos |
| **React Native** | Não | Inicial, mas existe |

---

## Análise SWOT — Ultra Media vs Video.js 10

### Forças do Ultra Media

1. **Plugin = solução pronta** — DRM, analytics, ads, bookmark, cuepoints, QoS como configuração, não como código
2. **Simplicidade radical** — Uma tag, cinco formatos, zero configuração
3. **YouTube nativo** — Proxy completo da API HTMLMediaElement (515 linhas)
4. **DASH nativo** — Video.js 10 foca em HLS; Ultra Media suporta dash.js nativamente
5. **Bundle mínimo real** — Sem store reativo, sem slices, sem camada de element reativo
6. **Zero lock-in de framework** — Video.js 10 depende de `@lit/context`
7. **Plugin model acessível** — IPlugin é trivial vs definePlayerFeature com slices

### Fraquezas do Ultra Media

1. **Skins** — Depende de media-chrome; sem UI própria
2. **React** — Sem hooks nativos; funciona via Web Component mas não é first-class
3. **Marca e confiança** — 1 mantenedor; empresas hesitam em adotar DRM de lib desconhecida
4. **Documentação** — Plugins enterprise precisam de docs enterprise
5. **Ecossistema** — Sem community governance, sem contribuidores externos

### Oportunidades

1. **Modelo "plugin = solução"** é o diferencial que Video.js 10 não pode copiar — abandonar composição funcional quebraria a filosofia da v10
2. **Janela beta** — Video.js 10 GA só em meados de 2026; produções hesitam em adotar beta
3. **90% do mercado** quer solução, não framework — esse público está mal servido
4. **Pacote `@ultra-media/react`** com `useUltraMedia()` resolveria a fraqueza React
5. **Pacote `@ultra-media/skin`** com default skin resolveria a fraqueza de UI
6. **Suporte pago / consultoria** como modelo de negócio (padrão open-source enterprise)

### Ameaças

1. **Brand power** — "Video.js" tem reconhecimento imediato
2. **Community size** — Base instalada do v7/v8 migra naturalmente para v10
3. **Funding** — Time profissional com dedicação full-time
4. **Documentation depth** — Investimento em docs difícil de igualar
5. **Feature completeness** — Quando atingirem GA, terão feature parity robusta

---

## Posicionamento Estratégico

### A narrativa

> **Video.js 10 te dá um framework para construir um player.**
> **Ultra Media te dá um player pronto para produção.**

### Público-alvo

| Público | Escolha provável |
|---------|-----------------|
| Dev que quer player na landing page | **Ultra Media** |
| Plataforma de streaming com time de 2-5 devs | **Ultra Media** |
| Netflix/Mux/empresa com time de media dedicado | **Video.js 10** |
| Startup que precisa de DRM + analytics rápido | **Ultra Media** |
| Empresa que quer controle total do player | **Video.js 10** |
| Projeto com YouTube + HLS + MP4 com zero config | **Ultra Media** |

### Categoria

Ultra Media não compete com Video.js 10 na mesma categoria. Video.js 10 é um **framework de media**. Ultra Media é um **player enterprise com plugins**. O modelo "plugin = solução pronta" serve 90% dos times que querem resultado, não arquitetura.

---

## Ações Recomendadas para Ultra Media

### Para fechar as fraquezas

1. **`@ultra-media/skin`** — Default skin próprio (não depender só de media-chrome)
2. **`@ultra-media/react`** — Hook `useUltraMedia()` para React first-class
3. **Docs enterprise** — Cada plugin com: guia de integração, API reference, exemplos por framework, troubleshooting por browser
4. **Testes E2E de DRM** — Essencial para credibilidade enterprise
5. **Cases públicos** — Demonstrar em produção real

### Para maximizar as forças

1. **Landing page com comparação de DX** — Mostrar 30 linhas vs 1000 linhas para o mesmo resultado
2. **"5 minutes to production"** — Tutorial que vai de zero a player com DRM + analytics em 5 minutos
3. **Plugin marketplace / registry** — Permitir plugins de terceiros
4. **Suporte pago** — Modelo open-core para enterprise

---

*Análise realizada em 2026-03-11 | Comparação baseada em Video.js 10.0.0-beta.3*
