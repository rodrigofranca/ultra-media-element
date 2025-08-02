# Tarefas de Implementação: Adicionar Suporte a YouTube Embed

Esta é uma lista de tarefas detalhadas para a implementação do suporte a YouTube Embed no `ultra-media-element`.

## 1. Atualizar `format-detector.ts`
- [x] Adicionar `Format.YOUTUBE` ao enum `Format` em `src/core/format.ts`.
- [x] Modificar a função `detectFormat` em `src/core/format-detector.ts` para identificar URLs do YouTube (ex: `youtube.com/watch?v=`, `youtu.be/`).

## 2. Criar `youtube-player.ts`
- [x] Criar o arquivo `src/players/youtube-player.ts`.
- [x] Definir a classe `YouTubePlayer` que implementa `IMediaPlayer`.
- [x] Implementar uma função utilitária para carregar a API do YouTube Player de forma assíncrona (inspirado no `loadScript` da referência).
- [x] No construtor de `YouTubePlayer`, criar um `<iframe>` e anexá-lo ao `element` fornecido.
- [x] Implementar a lógica para inicializar o player do YouTube dentro do iframe quando a API estiver pronta.
- [x] Implementar os métodos `load()`, `play()`, `pause()`, `destroy()` e outros métodos de `IMediaPlayer` para interagir com a API do YouTube Player.
- [x] Mapear eventos do YouTube Player (ex: `onStateChange`) para eventos do `HTMLMediaElement` (ex: `play`, `pause`, `ended`).
- [x] Simular as propriedades da API `HTMLMediaElement` (ex: `currentTime`, `volume`, `paused`, `duration`) usando os métodos da API do YouTube.

## 3. Atualizar `player-factory.ts`
- [x] Importar `YouTubePlayer` em `src/core/player-factory.ts`.
- [x] Adicionar `Format.YOUTUBE` e o tipo de engine correspondente (ex: `"youtube"`) ao `DEFAULT_FORMATS`.
- [x] Registrar a `YouTubePlayer` no `engines` `Map`, associando-a ao tipo de engine `"youtube"`.

## 4. Atualizar `ultra-media-element.ts`
- [x] Revisar `src/ultra-media-element.ts` para garantir que o `UltraMediaElement` possa lidar com o `<iframe>` do YouTube Player (posicionamento, visibilidade).
- [x] Verificar se a lógica de `attributeChangedCallback` para `src` funciona corretamente com URLs do YouTube, acionando a criação do `YouTubePlayer`.

## 5. Adicionar Testes para YouTube Embed
- [x] Criar o arquivo de teste `tests/youtube-player.test.ts`.
- [x] Escrever testes unitários para a classe `YouTubePlayer`, incluindo inicialização e interação com a API simulada do YouTube.
- [x] Adicionar testes de integração em `tests/player-factory.test.ts` para verificar se o `PlayerFactory` cria corretamente uma instância de `YouTubePlayer` para URLs do YouTube.
- [ ] Adicionar testes de integração/E2E para o `UltraMediaElement` para garantir que o componente funciona como esperado com URLs do YouTube (carregamento, play/pause, eventos).

## 6. Atualizar Documentação e Exemplos
- [x] Adicionar um novo exemplo em `core/examples/youtube-player.html` demonstrando o uso do `ultra-media-element` com uma URL do YouTube.
- [x] Atualizar o `core/examples/README.md` para incluir o novo exemplo.
- [x] Atualizar o `core/README.md` para incluir o suporte a YouTube.
- [x] Atualizar o `docs/tasks.md` marcando a tarefa de suporte a YouTube como concluída.