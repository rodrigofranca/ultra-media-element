# Plano de Refatoração: Iframe e Simulação de Eventos do YouTube Player

## Análise

Após a implementação inicial do suporte ao YouTube, foram identificados dois problemas principais:

1.  **Posicionamento do `<iframe>`:** O `<iframe>` do YouTube está sendo injetado dentro do elemento `<video>` nativo do `ultra-media-element`. A abordagem correta é que o `<iframe>` seja um irmão (sibling) do elemento `<video>`, ambos contidos dentro do `UltraMediaElement`.
2.  **Simulação de Eventos:** Para que o `ultra-media-element` seja compatível com UIs de player como `media-chrome`, ele precisa emitir os mesmos eventos de um elemento `<video>` padrão (`play`, `pause`, `timeupdate`, `ended`, etc.). A implementação atual não está traduzindo adequadamente os eventos da API do YouTube para os eventos padrão do `HTMLMediaElement`.

## Plano de Implementação

A seguir, um plano detalhado para refatorar a implementação do YouTube:

### 1. Refatorar a Criação do `<iframe>`

*   **Modificar `ultra-media-element.ts`:**
    *   Ao criar o `mediaPlayer` através da `PlayerFactory`, passar `this` (a instância do `UltraMediaElement`) como um novo parâmetro `container`.
*   **Modificar `player-factory.ts`:**
    *   Atualizar a `PlayerFactory` para aceitar o novo parâmetro `container` e passá-lo para o construtor do `YouTubePlayer`.
*   **Modificar `youtube-player.ts`:**
    *   Atualizar o construtor do `YouTubePlayer` para receber o `container` (`UltraMediaElement`).
    *   A lógica de anexação do `<iframe>` deve ser alterada de `element.appendChild(iframe)` para `container.appendChild(iframe)`.
    *   Adicionar lógica para ocultar o elemento `<video>` nativo (`element.style.display = 'none'`) quando o player do YouTube estiver ativo.
    *   Garantir que o `<iframe>` seja estilizado para preencher o espaço do componente.

### 2. Implementar a Simulação de Eventos

*   **Modificar `youtube-player.ts`:**
    *   Dentro do manipulador de eventos `onStateChange` da API do YouTube, usar um `switch` para mapear os estados do YouTube para os eventos padrão do `HTMLMediaElement`.
    *   Disparar os eventos diretamente no `container` (`UltraMediaElement`) usando `this.container.dispatchEvent(new Event('...'))`.
    *   **Mapeamento de Eventos Essenciais:**
        *   `PLAYING`: Disparar o evento `play`.
        *   `PAUSED`: Disparar o evento `pause`.
        *   `ENDED`: Disparar o evento `ended`.
        *   `BUFFERING`: Disparar o evento `waiting`.
    *   **Implementar `timeupdate`:** Usar `setInterval` para chamar `api.getCurrentTime()` periodicamente enquanto o vídeo estiver tocando e disparar o evento `timeupdate` no `container`. O `setInterval` deve ser iniciado no estado `PLAYING` e limpo nos estados `PAUSED`, `ENDED` ou ao destruir o player.
    *   **Implementar outros eventos:** Mapear `onPlaybackRateChange` para o evento `ratechange` e `onVolumeChange` para o evento `volumechange`.
    *   **Implementar `durationchange`:** Disparar o evento `durationchange` uma vez que o vídeo do YouTube tenha sido carregado e a duração esteja disponível (`api.getDuration()`).

### 3. Adicionar Testes de Comportamento

*   **Atualizar `tests/youtube-player.test.ts`:**
    *   Adicionar testes para verificar se o `<iframe>` é anexado ao `container` correto e não ao elemento de vídeo.
    *   Adicionar testes para simular uma chamada do `onStateChange` da API do YouTube e verificar se o evento DOM correspondente é disparado no `container`.

### 4. Atualizar Documentação

*   Atualizar os documentos de implementação existentes para refletir a nova abordagem de manipulação do DOM e simulação de eventos.
