# Public API — `<ultra-media>` (contract snapshot)

Inventário da API pública **efetiva** de `<ultra-media>` — própria +
herdada da base da casca + herdada de `media-tracks@0.3.5`
(`MediaTracksMixin`). Escrito originalmente na Fase 1 do ADR-0001 (quando a
base era `super-media-element@1.4.2`/`SuperVideoElement`), **atualizado na
etapa 3** (migração para `custom-media-element@1.4.6`/`CustomVideoElement` —
ver ADR-0001 D3 e `.scratch`/`fronts/shell-migration/result.md` "Diferenças
da base" e "Mudanças de contrato" para o histórico completo da migração).
Continua congelando o contrato: nenhum destes membros deve mudar de nome,
tipo ou comportamento observável sem passar pelo mesmo processo de decisão
documentado (repor na casca vs. aceitar a mudança).

Método: os membros próprios foram lidos direto de `src/ultra-media-element.ts`.
Os herdados foram obtidos introspectando a classe real registrada
(`customElements.get('ultra-media')`) em um Chromium real, depois de
`pnpm build`, contra o bundle publicado (`dist/ultra-media.es.js`) — não
contra os `.d.ts` ou a leitura do pacote `custom-media-element`/`media-tracks`,
para capturar exatamente o que o mixin instala em runtime (inclui passthrough
de propriedades nativas do `<video>`, adicionado dinamicamente por
`custom-media-element`'s `#define()`). Total: **94 membros** (15 próprios,
79 herdados: 6 de `custom-media-element` + 65 passthrough de
`HTMLVideoElement`/`HTMLMediaElement` + 8 de `media-tracks`) — a composição
dos 6 diretos mudou (`loadComplete`/`isLoaded` saíram, `init`/`handleEvent`
entraram) mas a contagem total ficou igual; ver "Mudanças de contrato" no
result.md da migração. Duas novas estáticas (`getTemplateHTML`,
`shadowRootOptions`) também chegaram com a nova base — ver a tabela
"Estáticos" abaixo — mas não somam ao inventário original de 93, que só
contabilizava estáticas específicas (`Events`/`observedAttributes`/
`skipAttributes`) e membros de instância/protótipo. **ADR-0001 D4 (etapa 4,
`fronts/request-policy/result.md`):** `request` (get/set accessor) somou-se
aos próprios — 93 → 94; sem atributo HTML correspondente (headers com token
não pertencem a markup).

## Estáticos

| Membro | Valor / tipo | Origem | Coberto por |
|---|---|---|---|
| `static Events` | `string[]`, 28 entradas — todos os eventos de `custom-media-element.Events` exceto `'error'` (ver Descobertas) | próprio (filtra a lista herdada) | `tests/public-contract.test.ts` (regra do filtro) + `e2e/tests/public-contract.spec.ts` (lista real completa) |
| `static observedAttributes` | `string[]`, 14 entradas — os 13 de `custom-media-element` + `'live'` | próprio (estende a lista herdada) | idem |
| `static skipAttributes` | `['src']` | próprio — a base não lê mais esse membro (ver "Comportamento de `src`" abaixo); a própria `attributeChangedCallback` da casca agora consulta o valor para decidir o que pular | `tests/public-contract.test.ts` |
| `static getTemplateHTML` | função (gera o HTML inicial do shadow root) | `custom-media-element` (novo — não existia em `super-media-element`, que usava um `template` compartilhado por todas as instâncias) | `e2e/tests/public-contract.spec.ts` |
| `static shadowRootOptions` | `{ mode: 'open' }` | `custom-media-element` (novo) | `e2e/tests/public-contract.spec.ts` |

## Atributos observados ↔ propriedades

| Atributo | Tipo refletido | Origem | Notas |
|---|---|---|---|
| `src` | string, mas em `skipAttributes` — a reflexão attr→nativeEl é pulada (agora enforçada pela própria casca, não pela base — ver "Comportamento de `src`"); a troca de player acontece via `attributeChangedCallback` próprio | próprio + `custom-media-element` | `applySrcChange` decide troca de engine vs `player.load()` |
| `autoplay`, `controls`, `loop`, `playsinline`, `crossorigin`, `poster`, `preload`, `controlslist`, `disablepictureinpicture`, `disableremoteplayback` | boolean ou string, refletidos genericamente pelo getter/setter que `custom-media-element` instala para cada prop nativa existente | `custom-media-element` | `e2e/tests/public-contract.spec.ts` |
| `autopictureinpicture` | observado, mas **sem propriedade nativa correspondente** neste Chromium (`'autoPictureInPicture' in document.createElement('video')` é `false`) — `custom-media-element` só instala getter/setter para props que existem de fato no `<video>` real, então este atributo não reflete em nada hoje (ver Descobertas) | `custom-media-element` | `e2e/tests/public-contract.spec.ts` |
| `muted` | **não** é atributo-refletido pela via genérica (`custom-media-element` remove `muted` do conjunto attr↔prop de propósito, igual à base anterior); a propriedade `muted` é sempre um passthrough direto para `nativeEl.muted`; o atributo `muted` só define o estado inicial em `init()` (paridade com o `<video muted>` nativo do HTML) | `custom-media-element` | `e2e/tests/public-contract.spec.ts` (documenta a quirk) |
| `live` | boolean — presente → `options.live = true`; ausente → `'auto'` (ADR-0001 D5, etapa 5). Só lido na criação do core e em `configure({ live })` a cada mudança do atributo — como `request`, só afeta o próximo `load()`, não reconfigura um engine já em execução | próprio | `tests/public-contract.test.ts`, `e2e/tests/public-contract.spec.ts`, `e2e/tests/live.spec.ts` |

## Membros próprios (`UltraMediaElement`)

| Membro | Tipo | Coberto por |
|---|---|---|
| `constructor()` | — | `tests/ultra-media-element-lifecycle.test.ts` |
| `destroy(): void` | método, idempotente | `tests/ultra-media-element-lifecycle.test.ts` |
| `changeSource(newSrc: string): Promise<void>` | método (seta o atributo `src`) | `tests/public-contract.test.ts` |
| `getCurrentFormat(): Format \| undefined` | método | `tests/public-contract.test.ts` |
| `isLive` | **ADR-0001 D5 (etapa 5) — mudou de campo público solto para getter**: reflete `core.live.isLive` (`false` sem core/antes de qualquer `load()`) | `tests/public-contract.test.ts`, `e2e/tests/public-contract.spec.ts`, `e2e/tests/live.spec.ts` |
| `liveInfo` | getter, `LiveInfo \| undefined` (ADR-0001 D5) — reflete `core.live`; `undefined` sem core | `e2e/tests/live.spec.ts` |
| `goToLive()` | método (ADR-0001 D5) — delega a `core.goToLive()`; no-op silencioso fora de um live/sem core | `e2e/tests/live.spec.ts` |
| `streamType` | getter, `'live' \| 'on-demand'` (ADR-0001 D5) — compatibilidade media-chrome (`mediaStreamType`, `state-mediator.js`); `'on-demand'` sem core | `e2e/tests/live.spec.ts` |
| `targetLiveWindow` | getter, `number` (ADR-0001 D5) — compatibilidade media-chrome (`mediaTargetLiveWindow`); `NaN` fora de live, `0` em live sem DVR, janela em segundos com DVR | `e2e/tests/live.spec.ts` |
| `liveEdgeStart` | getter, `number` (ADR-0001 D5) — compatibilidade media-chrome (`mediaTimeIsLive`, `media-live-button`); `core.live.seekableEnd - 2` em live (a tolerância evita que o próprio `goToLive()` pareça "não ao vivo" logo depois de rodar — ver result.md), `NaN` fora de live | `e2e/tests/live.spec.ts` |
| `request` | get/set accessor, `RequestPolicy \| undefined` (ADR-0001 D4) — sem atributo HTML; `set` repassa para `core.configure({ request })` (só afeta o próximo `load()`) | `tests/public-contract.test.ts`, `e2e/tests/request-policy.spec.ts`, `e2e/tests/public-contract.spec.ts` |
| `connectedCallback()` | lifecycle (spec de Custom Elements) | `tests/ultra-media-element-lifecycle.test.ts` |
| `disconnectedCallback()` | lifecycle, teardown adiado por microtask | `tests/ultra-media-element-lifecycle.test.ts` |
| `attributeChangedCallback()` | lifecycle | `tests/ultra-media-element-lifecycle.test.ts` |
| `setupTrackListeners`, `applySrcChange`, `initializePlayer`, `removeAllMediaTracks` | detalhes internos (`private` em TS, mas visíveis em runtime — não fazem parte do contrato público) | não travados individualmente; comportamento observável coberto pelos testes acima |

## Herdados de `custom-media-element` (além do passthrough nativo)

`loadComplete`/`isLoaded` (a convenção `load()`-como-hook de
`super-media-element`) **saíram** nesta base; `init()`/`handleEvent()`
**entraram** em seu lugar — ver "Mudanças de contrato" no result.md da
migração para a decisão (aceitos como removidos: eram membros mortos na
prática, ver Descobertas).

| Membro | Tipo | Coberto por |
|---|---|---|
| `nativeEl` | getter/setter — retorna o `<video>` real dentro do shadow root | `e2e/tests/public-contract.spec.ts`; consumido por `ultra-media-ad.ts` (`getNativeVideoElement`) e pelo exemplo media-chrome |
| `src` | getter/setter, refletido no atributo `src` | `tests/public-contract.test.ts` + e2e |
| `preload` | getter/setter | `e2e/tests/public-contract.spec.ts` |
| `defaultMuted` | getter/setter, refletido no atributo `muted` | `e2e/tests/public-contract.spec.ts` |
| `init()` | método público, inicialização preguiçosa (shadow root + `nativeEl` + listeners) — chamado internamente pelo próprio `custom-media-element` na primeira leitura de qualquer propriedade/atributo; não é chamado pela casca diretamente | `e2e/tests/public-contract.spec.ts` |
| `handleEvent(event)` | método público, `EventListener` interface — recebe os eventos nativos de mídia encaminhados do shadow root e os redespacha como `CustomEvent` no elemento | `e2e/tests/public-contract.spec.ts` |

## Herdados de `custom-media-element` — passthrough nativo (`HTMLVideoElement`/`HTMLMediaElement`)

65 membros, instalados dinamicamente pelo mixin a partir do protótipo nativo de
`<video>` (getter/setter genérico para propriedades, função-proxy para
métodos — ambos delegam a `this.nativeEl`). Idêntico ao que `super-media-
element` instalava (mesmo algoritmo de introspecção do protótipo nativo) —
nenhum membro desta lista mudou de nome, tipo ou comportamento na migração.
Os citados explicitamente no brief têm teste dedicado; os demais são
travados em bloco pela mesma spec (lista exata comparada por igualdade).

| Membro | Coberto por |
|---|---|
| `currentTime`, `volume`, `muted`, `paused`, `duration` | `e2e/tests/public-contract.spec.ts` (proxy para `nativeEl`) + `e2e/tests/{hls,dash,mp3,mp4}.spec.ts` (uso real) |
| `play()`, `pause()`, `load()` | `e2e/tests/public-contract.spec.ts` + specs de playback |
| demais 58: `width`, `height`, `videoWidth`, `videoHeight`, `poster`, `webkitDecodedFrameCount`, `webkitDroppedFrameCount`, `playsInline`, `onenterpictureinpicture`, `onleavepictureinpicture`, `disablePictureInPicture`, `cancelVideoFrameCallback()`, `getVideoPlaybackQuality()`, `requestPictureInPicture()`, `requestVideoFrameCallback()`, `error`, `currentSrc`, `crossOrigin`, `networkState`, `buffered`, `readyState`, `seeking`, `defaultPlaybackRate`, `playbackRate`, `played`, `seekable`, `ended`, `autoplay`, `loop`, `preservesPitch`, `controls`, `controlsList`, `textTracks`, `webkitAudioDecodedByteCount`, `webkitVideoDecodedByteCount`, `onencrypted`, `onwaitingforkey`, `srcObject`, `NETWORK_EMPTY`..`NETWORK_NO_SOURCE` (4), `HAVE_NOTHING`..`HAVE_ENOUGH_DATA` (5), `addTextTrack()`, `canPlayType()`, `captureStream()`, `loading`, `sinkId`, `remote`, `disableRemotePlayback`, `setSinkId()`, `mediaKeys`, `setMediaKeys()` | `e2e/tests/public-contract.spec.ts` (lista exata, comparação estrutural — não uma a uma) |

## Herdados de `media-tracks`

| Membro | Tipo | Coberto por |
|---|---|---|
| `videoTracks` | `VideoTrackList` (iterável) | `tests/public-contract.test.ts` (mock) + `e2e/tests/public-contract.spec.ts` (real, lista vazia antes de carregar) |
| `audioTracks` | `AudioTrackList` (iterável) | idem; conteúdo real coberto por `hls.spec.ts`/`dash.spec.ts` |
| `videoRenditions` | `VideoRenditionList` (iterável) | idem; conteúdo real coberto por `hls.spec.ts`/`dash.spec.ts` |
| `audioRenditions` | `AudioRenditionList` (iterável, não populada hoje — nenhum player chama `addRendition` em audio track) | `e2e/tests/public-contract.spec.ts` (existe, vazia) |
| `addVideoTrack()`, `removeVideoTrack()`, `addAudioTrack()`, `removeAudioTrack()` | métodos | `tests/public-contract.test.ts` (chamados por `initializePlayer`'s `onTracksChange`) |

## Eventos

- `static Events` (28, ver acima) — todo evento nativo de mídia exceto
  `error` é reencaminhado de `nativeEl` como `CustomEvent` com
  `detail: undefined` (mecanismo do `custom-media-element`, shadow-root
  capturing listener + `handleEvent()`).
- `error` / `warning` — **não** vêm de `Events`; são emitidos só por
  `initializePlayer()`'s `player.onError()`, roteados por `fatal` (`detail`
  no shape de `MediaPlayerError`, `src/core/media-player.ts`). Cobertos por
  `e2e/tests/errors.spec.ts` (shape real via hls/dash/mp4) e
  `tests/public-contract.test.ts` (regra de roteamento fatal→error /
  não-fatal→warning, com player fake).

## `IMediaPlayer` / `MediaPlayerError` (contrato interno entre `PlayerFactory` e os players)

Contrato de tipos (`src/core/media-player.ts`), não exposto no DOM mas
central para a extração da Fase 2 — todo `UltraMediaCore.load()` vai depender
dele. Travado por `tests/player-factory.test.ts`,
`tests/hls-player.test.ts`, `tests/dash-player.test.ts`,
`tests/youtube-player*.test.ts`, `tests/native-media-error.test.ts`
(pré-existentes, não tocados nesta fase) e por checagem de tipos (`tsc`).

## O que `<ultra-media-ad>` e o exemplo media-chrome consomem

- `ultra-media-ad.ts` (`getNativeVideoElement`): exige `(element as any).nativeEl instanceof HTMLVideoElement` — nunca importa nada de `src/core`/`src/players`. Contrato: `nativeEl` deve continuar existindo e apontando para um `<video>` real.
- `examples/media-chrome-player.html`: consome o atributo `src`, eventos padrão (`play`, `pause`, `timeupdate`, `volumechange`, `durationchange`, `seeking`, `seeked`, `waiting`, `ended`, `ratechange`, `progress`, `loadedmetadata`), e as propriedades `currentTime`, `duration`, `paused`, `volume`, `muted`, `playbackRate`, `buffered`, `seekable`, `videoRenditions`, `audioTracks` — todos herdados, listados acima.

## Comportamento de `src`

- Atributo `src` está em `skipAttributes`: o player é quem decide o `nativeEl.src` real, via `Hls.loadSource` / `dash.attachSource` / `nativeEl.src =` — nunca a reflexão genérica de atributo. **Diferença da base (etapa 3):** `super-media-element` cuidava disso sozinho (o atributo nunca era copiado para `nativeEl`); `custom-media-element` **não** tem esse conceito — ele forçaria `nativeEl.setAttribute('src', <url bruta>)` a cada troca (a mesma URL de manifesto HLS/DASH que o player real nunca deveria ver). A própria `attributeChangedCallback` da casca agora intercepta isso: para atributos em `skipAttributes`, ela força a inicialização preguiçosa (lendo `nativeEl`) sem chamar `super.attributeChangedCallback()`, pulando o passo de encaminhamento da base inteiramente.
- `src` (propriedade) é a getter/setter própria da base — sempre refletida no atributo (`get/set src` — não usa o passthrough genérico).
- `changeSource(newSrc)` é só um atalho para `setAttribute('src', newSrc)`, com um `console.warn` se `newSrc` for falsy.

## Descobertas

- **ADR-0001 D5 (etapa 5)** — o atributo `live` deixou de ser morto: agora
  seeda `options.live` na criação do core e via `configure()` a cada
  mudança; `isLive` virou getter refletindo `core.live.isLive`. Ver a seção
  "Live" abaixo e `fronts/live/result.md`.
- `src/ultra-media-element.ts:118-129` (comentário de `destroy()`) — `load()`
  tinha significado reservado em `super-media-element` (hook por-subclasse
  auto-invocado via `attributeChangedCallback`, com `loadComplete`/
  `isLoaded` como promessa em torno dele); como `UltraMediaElement` nunca
  sobrescrevia `load()`, esses dois membros nunca viravam uma Promise real
  na prática — confirmado empiricamente antes da migração. **Etapa 3:**
  `custom-media-element` remove essa convenção inteira (não tem hook
  `load()`, não tem `loadComplete`/`isLoaded`) — como já eram mortos, a
  remoção não muda nenhum comportamento observável real; ver "Mudanças de
  contrato" no result.md da migração para a decisão formal.
- `muted` (propriedade) não é atributo-refletida como as demais booleanas
  (a base remove `muted` do conjunto genérico de propósito, em ambas as
  versões da base) — fácil de confundir com `autoplay`/`controls`/etc.
- `autopictureinpicture` está em `observedAttributes` (herdado da lista
  estática da base) mas não existe `autoPictureInPicture` como propriedade
  real em `HTMLVideoElement` neste Chromium — o loop de `nativeElProps` da
  base só instala getter/setter para propriedades que o `<video>` de teste
  realmente tem, então esse atributo não reflete em nenhuma propriedade
  hoje (`el.autoPictureInPicture` é sempre `undefined`). Confirmado em
  `e2e/tests/public-contract.spec.ts`; inalterado pela etapa 3.
- **Etapa 3** — `custom-media-element`'s `disconnectedCallback()` (ausente
  em `super-media-element`, que era um no-op) agora desfaz de verdade seus
  próprios listeners/observers a cada desconexão, mesmo numa
  desconexão+reconexão síncrona (elemento movido no DOM) — reconectado, o
  próprio `connectedCallback()` da base os recria antes do próximo evento
  de mídia real ter chance de disparar; nenhum teste observou perda de
  evento. Ver result.md "Diferenças da base" para o detalhe.

## Live (ADR-0001 D5, etapa 5)

O núcleo headless (`src/core/media-player.ts`, `src/core/ultra-media-core.ts`)
ganhou:

```ts
interface LiveInfo {
  isLive: boolean;
  seekableStart: number;
  seekableEnd: number;
  liveEdge: number;       // === seekableEnd (simplificação documentada, ver result.md)
  dvr: boolean;           // seekableEnd - seekableStart > 30s (limiar fixo, ver result.md)
  latency?: number;       // não implementado (custo de tamanho) - hosts podem calcular seekableEnd - currentTime
  playheadDate: Date | null;
}
UltraMediaCoreOptions.live?: boolean | 'auto';  // default 'auto'
core.live: LiveInfo;                            // snapshot imutável, atualizado com 'livechange'
core.goToLive(): void;
eventos: 'livechange' (detail: LiveInfo), 'streamended' (sem detail)
```

Matriz engine × capacidade (ver `fronts/live/result.md` para a evidência
completa): hls.js e dash.js implementam isLive/borda inicial/goToLive/dvr/
playheadDate/streamended via a própria SDK (`LEVEL_LOADED`/`isDynamic()`);
nativo (mp4/mp3) via `duration === Infinity`; YouTube sempre `isLive: false`
(fora de escopo). A borda inicial (hls.js `liveSyncPosition`, dash.js seu
próprio delay de live) é comportamento **default** das duas SDKs — nenhum
código próprio força isso. **Desvio conhecido**: o fallback HLS nativo sem
MSE (Safari/TVs antigas) não implementa live (ver `hls-player.ts`'s
`goToLive()`).

Na casca: `live` (atributo), `isLive`/`liveInfo`/`goToLive()` (mirror do
core), e `streamType`/`targetLiveWindow`/`liveEdgeStart` (compatibilidade
`media-chrome` — `media-live-button`/`media-time-range` leem essas três via
`state-mediator.js`'s `mediaStreamType`/`mediaTargetLiveWindow`/
`mediaTimeIsLive`, que não são propriedades nativas de `HTMLVideoElement`
que `custom-media-element` repasse sozinho). `livechange`/`streamended`
redespachados como `CustomEvent`; a cada `livechange` a casca também dispara
`streamtypechange`/`targetlivewindowchange` (síntéticos, não nativos — é o
que fazem `mediaStreamType`/`mediaTargetLiveWindow` reavaliarem).

## Sumário do inventário

- **99 membros** efetivos (era 94 antes da etapa 5): 20 próprios (10
  métodos/lifecycle + `isLive` + `request` + `liveInfo` + `goToLive` +
  `streamType` + `targetLiveWindow` + `liveEdgeStart` + 3 estáticos), 79
  herdados (6 `custom-media-element` diretos + 65 passthrough nativo + 8
  `media-tracks`). O teste e2e de inventário (`public-contract.spec.ts`, que
  só percorre o protótipo de instância, sem estáticos) usa uma contagem
  paralela: 19 próprios + 79 herdados = 98 (era 92 antes da etapa 5) — ver
  esse arquivo para a lista exata.
- **14 atributos observados** (inalterado — `request` não é atributo,
  ADR-0001 D4; `live` ganhou efeito real na etapa 5 sem virar um novo
  atributo), **28 eventos nativos reencaminhados** + 2 eventos próprios de
  erro (`error`/`warning`) + 2 eventos próprios de live (`livechange`/
  `streamended`, ADR-0001 D5) com shape dedicado.
- **Etapa 5 (live, ADR-0001 D5):** `isLive` (campo público → getter),
  `liveInfo`/`goToLive`/`streamType`/`targetLiveWindow`/`liveEdgeStart`
  (novos) somaram-se aos membros próprios. Ver `fronts/live/result.md`.
- **Etapa 4 (request policy, ADR-0001 D4):** `request` (get/set) somou-se
  aos membros próprios — 93 → 94. Ver `fronts/request-policy/result.md`.
- **Etapa 3 (migração `super-media-element` → `custom-media-element`,
  ADR-0001 D3):** contagem total inalterada (93), mas 2 dos 6 membros
  diretos da base mudaram (`loadComplete`/`isLoaded` → `init`/
  `handleEvent` — aceito como remoção, eram mortos) e 2 estáticas novas
  chegaram (`getTemplateHTML`, `shadowRootOptions`, fora da contagem
  original de 93). Nenhum outro membro mudou de nome, tipo ou comportamento
  observável. Ver `fronts/shell-migration/result.md` para a tabela completa
  "Mudanças de contrato" e "Diferenças da base".
