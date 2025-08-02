# Tarefas de Refatoração: Iframe e Simulação de Eventos do YouTube Player

Esta é uma lista de tarefas detalhadas para a refatoração da implementação do suporte a YouTube Embed.

## 1. Refatorar a Criação do `<iframe>`

- [x] **`ultra-media-element.ts`**: Modificar a criação do `mediaPlayer` para passar `this` como um novo parâmetro `container` para a `PlayerFactory`.
- [x] **`player-factory.ts`**: Atualizar a `PlayerFactory` para aceitar o novo parâmetro `container` e passá-lo para o construtor do `YouTubePlayer`.
- [x] **`youtube-player.ts`**: Atualizar o construtor do `YouTubePlayer` para receber o `container` (`UltraMediaElement`).
- [x] **`youtube-player.ts`**: Alterar a lógica de anexação do `<iframe>` para `container.appendChild(iframe)`.
- [x] **`youtube-player.ts`**: Adicionar lógica para ocultar o elemento `<video>` nativo (`element.style.display = 'none'`) quando o player do YouTube estiver ativo.
- [x] **`youtube-player.ts`**: Garantir que o `<iframe>` seja estilizado para preencher o espaço do componente.

## 2. Implementar a Simulação de Eventos

- [x] **`youtube-player.ts`**: No manipulador `onStateChange`, mapear o estado `PLAYING` para o evento `play`.
- [x] **`youtube-player.ts`**: No manipulador `onStateChange`, mapear o estado `PAUSED` para o evento `pause`.
- [x] **`youtube-player.ts`**: No manipulador `onStateChange`, mapear o estado `ENDED` para o evento `ended`.
- [x] **`youtube-player.ts`**: No manipulador `onStateChange`, mapear o estado `BUFFERING` para o evento `waiting`.
- [x] **`youtube-player.ts`**: Implementar `setInterval` para disparar o evento `timeupdate` periodicamente.
- [x] **`youtube-player.ts`**: Mapear `onPlaybackRateChange` para o evento `ratechange`.
- [x] **`youtube-player.ts`**: Disparar o evento `durationchange` quando a duração do vídeo estiver disponível.

## 3. Adicionar Testes de Comportamento

- [x] **`tests/youtube-player.test.ts`**: Adicionar teste para verificar se o `<iframe>` é anexado ao `container` correto.
- [x] **`tests/youtube-player.test.ts`**: Adicionar teste para verificar se o evento `play` é disparado no `container`.
- [x] **`tests/youtube-player.test.ts`**: Adicionar teste para verificar se o evento `pause` é disparado no `container`.
- [x] **`tests/youtube-player.test.ts`**: Adicionar teste para verificar se o evento `ended` é disparado no `container`.

## 4. Atualizar Documentação

- [x] Atualizar os documentos de implementação existentes para refletir a nova abordagem.