# Plano de Implementação: YouTube Player Proxy Pattern

## Análise

Após a implementação inicial do suporte ao YouTube no `ultra-media-element`, foi identificado um problema crítico de compatibilidade com o `media-chrome` e outras bibliotecas que esperam interagir com o elemento `<video>` nativo:

**Problema Principal**: O YouTube player bypassa o `nativeEl` (HTMLVideoElement), fazendo com que:
1. Propriedades como `currentTime`, `duration`, `volume` não sejam acessíveis via `nativeEl`
2. Métodos como `play()`, `pause()` no `nativeEl` não controlem o YouTube player
3. Eventos sejam disparados no `container` em vez do `nativeEl`, quebrando a compatibilidade com media-chrome

**Root Cause**: O media-chrome espera interagir com o `nativeEl` do ultra-media-element, mas o YouTube player:
- Implementa propriedades diretamente na instância do YouTubePlayer
- Dispara eventos no container (ultra-media-element) em vez do nativeEl
- Methods do nativeEl não são interceptados para controlar o YouTube player

## Solução: Proxy Pattern

Implementar um sistema de proxy que faz o `nativeEl` atuar como proxy transparente para o YouTube player, sincronizando:
- **Propriedades**: currentTime, duration, volume, muted, paused, ended, playbackRate
- **Métodos**: play(), pause(), load()
- **Eventos**: Todos os eventos HTMLMediaElement disparados no nativeEl

## Plano de Implementação

A implementação será dividida em 4 fases sequenciais:

### Fase 1: Preparação e Estrutura Base

**Objetivo**: Criar a infraestrutura base para o sistema de proxy

**Implementação**:
1. **Interface ElementProxy**: Definir contratos para `setupProxy()` e `cleanupProxy()`
2. **Backup System**: Sistema para armazenar e restaurar métodos/propriedades originais
3. **Lifecycle Integration**: Integrar setup/cleanup no ciclo de vida do YouTubePlayer

**Arquivos Modificados**:
- `src/players/youtube-player.ts`

### Fase 2: Property Synchronization  

**Objetivo**: Sincronizar propriedades do nativeEl com o YouTube player

**Implementação**:
1. **Property Getters/Setters**: Sobrescrever propriedades do nativeEl usando `Object.defineProperty()`
2. **Bidirectional Sync**: Leitura via YouTube API, escrita via YouTube API + eventos
3. **Fallback System**: Valores padrão quando YouTube player não disponível

**Propriedades Implementadas**:
- `currentTime` (read/write) → `player.getCurrentTime()` / `player.seekTo()`
- `duration` (read-only) → `player.getDuration()`
- `volume` (read/write) → `player.getVolume()` / `player.setVolume()`
- `muted` (read/write) → `player.isMuted()` / `player.mute()`
- `paused` (read-only) → baseado em `player.getPlayerState()`
- `ended` (read-only) → baseado em `player.getPlayerState()`
- `playbackRate` (read/write) → `player.getPlaybackRate()` / `player.setPlaybackRate()`
- `buffered` (read-only) → TimeRanges customizado

### Fase 3: Method Interception

**Objetivo**: Interceptar métodos do nativeEl para controlar o YouTube player

**Implementação**:
1. **Method Override**: Sobrescrever `play()`, `pause()`, `load()` do nativeEl
2. **YouTube API Integration**: Redirecionar chamadas para YouTube player
3. **Fallback Handling**: Usar métodos originais quando YouTube player indisponível

**Métodos Implementados**:
- `play()` → `player.playVideo()`
- `pause()` → `player.pauseVideo()`
- `load()` → Recarregar vídeo YouTube

### Fase 4: Event System Refactoring

**Objetivo**: Refatorar sistema de eventos para compatibilidade com media-chrome

**Implementação**:
1. **Event Target Change**: Mudar todos os eventos de `container` para `nativeEl`
2. **Enhanced Events**: Adicionar eventos de lifecycle (`canplay`, `canplaythrough`)
3. **Complete HTMLMediaElement Compatibility**: Garantir que todos os eventos padrão sejam emitidos

**Eventos Refatorados**:
- Lifecycle: `emptied`, `loadstart`, `loadedmetadata`, `durationchange`, `canplay`, `canplaythrough`
- Playback: `play`, `playing`, `pause`, `ended`, `waiting`
- Interaction: `seeking`, `seeked`, `timeupdate`, `volumechange`, `ratechange`
- Progress: `progress`

## Arquitetura Final

```
┌─────────────────────────────────────┐
│           media-chrome              │
│  (ouve eventos do nativeEl)         │
└─────────────────┬───────────────────┘
                  │
┌─────────────────▼───────────────────┐
│         ultra-media-element         │
│  ┌─────────────────────────────────┐ │
│  │         nativeEl (proxy)        │ │◄─── Properties & Methods
│  │   - currentTime → YT.player     │ │◄─── Events dispatched here
│  │   - play() → YT.playVideo()     │ │
│  │   - events from YT.player       │ │
│  └─────────────────────────────────┘ │
│  ┌─────────────────────────────────┐ │
│  │       YouTube iframe            │ │
│  │    (positioned as sibling)      │ │
│  └─────────────────────────────────┘ │
└─────────────────────────────────────┘
```

## Resultado Esperado

**Compatibilidade Total**: O nativeEl funcionará como proxy transparente para o YouTube player, permitindo que media-chrome e outras bibliotecas:

1. **Leiam propriedades** diretamente do nativeEl (`currentTime`, `duration`, etc.)
2. **Controlem playback** via métodos do nativeEl (`play()`, `pause()`)
3. **Recebam eventos** padrão do nativeEl (`timeupdate`, `volumechange`, etc.)

**Transparência**: O comportamento será idêntico ao de outros formatos de mídia (HLS, DASH, MP4), mantendo a API unificada do ultra-media-element.