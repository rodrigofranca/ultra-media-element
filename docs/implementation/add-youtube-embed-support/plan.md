# Plano de Implementação: Adicionar Suporte a YouTube Embed

## Análise

O projeto `ultra-media-element` já possui uma arquitetura modular para lidar com diferentes formatos de mídia, utilizando um `format-detector` e uma `PlayerFactory` para instanciar o player correto (HLS, DASH, MP4). A adição do YouTube Embed exigirá a criação de um novo tipo de "player" que, em vez de reproduzir um stream diretamente, irá gerenciar um `<iframe>` do YouTube e interagir com a API do YouTube Player.

Isso implica em:
1.  **Detecção de Formato:** O `format-detector` precisará identificar URLs do YouTube.
2.  **Novo Player:** Uma nova classe (`YouTubePlayer`) será necessária para encapsular a lógica de carregamento do iframe do YouTube e a interação com sua API do YouTube Player.
3.  **Integração:** O `PlayerFactory` precisará ser atualizado para criar instâncias de `YouTubePlayer` quando uma URL do YouTube for detectada.
4.  **API do YouTube:** A `YouTubePlayer` precisará carregar a API do YouTube Player e traduzir os comandos do `IMediaPlayer` (play, pause, seek, etc.) para as chamadas da API do YouTube.

## Plano

A seguir, um plano detalhado para adicionar o suporte a YouTube Embed:

1.  **Atualizar `format-detector.ts`:**
    *   Adicionar lógica para detectar URLs do YouTube (ex: `youtube.com/watch?v=`, `youtu.be/`).
    *   Definir um novo `Format` (ex: `Format.YOUTUBE`) para o YouTube.

2.  **Criar `youtube-player.ts`:**
    *   Criar uma nova classe `YouTubePlayer` em `src/players/`.
    *   Esta classe deve implementar a interface `IMediaPlayer`.
    *   No construtor, criar um `<iframe>` e anexá-lo ao `container` (`UltraMediaElement`), que é passado como parâmetro.
    *   Carregar a API do YouTube Player (via script externo) e inicializar o player do YouTube dentro do iframe.
    *   Implementar os métodos `load()`, `play()`, `pause()`, `destroy()` e outros métodos da interface `IMediaPlayer` para interagir com a API do YouTube Player.
    *   Mapear eventos do YouTube Player para eventos do `HTMLMediaElement` (ex: `onStateChange` para `play`, `pause`, `ended`, `timeupdate`) e despachá-los no `container`.

3.  **Atualizar `player-factory.ts`:**
    *   Importar a nova classe `YouTubePlayer`.
    *   Adicionar o novo `Format.YOUTUBE` e o tipo de engine correspondente (ex: `"youtube"`) ao `DEFAULT_FORMATS`.
    *   Registrar a `YouTubePlayer` no `engines` `Map`, associando-a ao tipo de engine `"youtube"`.

4.  **Atualizar `ultra-media-element.ts`:**
    *   Passar `this` (a instância do `UltraMediaElement`) como o `container` ao criar o `mediaPlayer`.
    *   Verificar se a lógica de `attributeChangedCallback` para `src` funciona corretamente com URLs do YouTube, acionando a criação do `YouTubePlayer`.

5.  **Adicionar Testes para YouTube Embed:**
    *   Criar um novo arquivo de teste (ex: `youtube-player.test.ts`) para a classe `YouTubePlayer`.
    *   Adicionar testes para verificar se o `<iframe>` é anexado ao `container` correto.
    *   Adicionar testes para verificar se os eventos (`play`, `pause`, `ended`) são disparados no `container`.

6.  **Atualizar Documentação e Exemplos:**
    *   Adicionar um novo exemplo em `core/examples/` (`youtube-player.html`) demonstrando o uso do `ultra-media-element` com uma URL do YouTube.
    *   Atualizar o `core/README.md` para incluir o suporte a YouTube.
    *   Atualizar o `docs/tasks.md` marcando a tarefa como concluída.
