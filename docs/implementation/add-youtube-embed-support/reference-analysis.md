# Análise da Implementação de Referência (`youtube-video-element`)

## Estrutura e Padrões

1.  **Web Component Nativo:** A implementação é um Web Component nativo que estende `HTMLElement`. Isso é diferente da abordagem do `ultra-media-element`, que estende `SuperVideoElement`. A abordagem nativa oferece mais controle, mas também exige a implementação manual de toda a API `HTMLMediaElement`.
2.  **Shadow DOM:** Utiliza Shadow DOM para encapsular a UI (o `<iframe>` e os estilos). Isso é uma boa prática para evitar conflitos de estilo.
3.  **Carregamento da API do YouTube:** A API do YouTube (`iframe_api`) é carregada dinamicamente via `loadScript`, com um cache para evitar carregamentos múltiplos. Isso é eficiente e evita o bloqueio da renderização inicial.
4.  **Gerenciamento de Estado:** A classe gerencia seu próprio estado interno (`#readyState`, `#seeking`, `#isLoaded`, etc.) e dispara eventos padrão do `HTMLMediaElement` (`play`, `pause`, `ended`, `timeupdate`, etc.). Isso é crucial para que o componente se comporte como um elemento de mídia nativo.
5.  **API `HTMLMediaElement`:** A classe implementa as propriedades e métodos da API `HTMLMediaElement` (ex: `play()`, `pause()`, `currentTime`, `volume`, `paused`, `duration`). Isso permite que o componente seja controlado da mesma forma que um `<video>` nativo.
6.  **`attributeChangedCallback`:** Utiliza `attributeChangedCallback` para reagir a mudanças em atributos como `src`, `autoplay`, `controls`, etc., e recarregar o player quando necessário.
7.  **`PublicPromise`:** Utiliza uma classe `PublicPromise` para gerenciar promessas de forma mais conveniente (ex: `loadComplete`).

## Pontos Chave para a Implementação do `ultra-media-element`

1.  **Não Estender `HTMLVideoElement`:** A referência estende `HTMLElement`. Para o `ultra-media-element`, que já tem uma estrutura baseada em `SuperVideoElement`, a abordagem será criar uma classe `YouTubePlayer` que *implementa* a interface `IMediaPlayer`, mas que internamente gerencia um `<iframe>` em vez de um `<video>`.
2.  **Carregamento da API:** A lógica de `loadScript` da referência é uma boa inspiração para carregar a API do YouTube de forma assíncrona e segura.
3.  **Mapeamento de Eventos:** O mapeamento de eventos do `onStateChange` da API do YouTube para os eventos padrão do `HTMLMediaElement` é um ponto crucial a ser replicado. Isso garante que o `UltraMediaElement` possa ouvir e reagir a esses eventos da mesma forma que faz com os outros players.
4.  **Simulação da API `HTMLMediaElement`:** A `YouTubePlayer` precisará simular as propriedades e métodos da API `HTMLMediaElement` que são esperados pela interface `IMediaPlayer` e pelo `UltraMediaElement`. Por exemplo, `currentTime` deverá chamar `api.getCurrentTime()`, `volume` deverá chamar `api.getVolume()`, etc.
5.  **Criação do `<iframe>`:** A lógica de criar e gerenciar o `<iframe>` dentro do elemento host é fundamental. O `YouTubePlayer` será responsável por criar, configurar e destruir o `<iframe>`.
6.  **Parâmetros do `<iframe>`:** A função `serializeIframeUrl` da referência é um bom exemplo de como construir a URL do `<iframe>` com os parâmetros corretos (autoplay, controls, etc.) com base nos atributos do elemento.
