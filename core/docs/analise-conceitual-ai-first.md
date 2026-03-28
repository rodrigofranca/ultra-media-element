# Análise Conceitual — AI-First para Projeto de Autoridade

> Data: 2026-03-11
> Contexto: Ultra Media Element como projeto de autoridade em players de vídeo web
> Inspiração: Análise do setup AI-first do Video.js 10, adaptado ao paradigma do Ultra Media

---

## Premissa

O Video.js 10 usa AI para manter **consistência de engenharia**. O Ultra Media Element deve usar AI para manter **consistência de visão**. Essa é a diferença entre um projeto técnico e um projeto de autoridade.

Um projeto de autoridade não é apenas código bem escrito — é código que **materializa um ponto de vista** sobre como players de vídeo deveriam funcionar, fundamentado em 15 anos de experiência construindo players.

---

## 1. API Design como Filosofia

### O que o Video.js 10 faz

Mantém um skill inteiro (`api`) com 7 arquivos de referência dedicados a **como pensar sobre APIs** — não o código, mas os princípios. Cada decisão de interface é avaliada contra critérios explícitos: progressive disclosure, emergent extensibility, inference-first TypeScript, composition over configuration.

### O que isso significa para o Ultra Media

Para um projeto de autoridade, a API **é** o paradigma. Ela precisa de princípios documentados:

**Progressive Disclosure:**
- O player funciona com `<ultra-media src="video.mp4">` — zero config
- Escala até DRM + ads + analytics sem que o caso simples fique complexo
- Cada nível de complexidade é opt-in, nunca imposto

**Emergent Extensibility:**
- O plugin system deveria ser tão natural que não pareça um plugin system
- Estender o player deveria ser consequência do bom design, não de uma API de plugins bolted-on
- Se alguém precisa ler documentação de plugins para fazer algo básico, o design falhou

**Pit of Success:**
- O caminho certo é o mais fácil
- Se alguém consegue usar errado, o design falhou — não o desenvolvedor
- Defaults inteligentes eliminam configuração para 80% dos casos

**O que diferencia "mais um player" de "um paradigma":**
- Ter princípios explícitos que guiam cada decisão de API
- Consistência total — cada endpoint, cada prop, cada evento segue a mesma filosofia
- Um "manifesto de design" que o agente AI usa como referência em toda decisão

### Ação

Criar um documento de princípios de design do Ultra Media — o manifesto que guia toda decisão de API. Não é documentação para o usuário final, é o DNA do projeto.

---

## 2. Practitioner Voices — Convicções Codificadas

### O que o Video.js 10 faz

Mantém um arquivo `voices.md` com perspectivas de experts (Tanner Linsley, Kent C. Dodds, Ryan Carniato, Devon Govett, etc.) como "lentes de avaliação". Cada perspectiva é uma pergunta que o agente usa para avaliar decisões:

- "Could this work across frameworks with the same core?" (Tanner Linsley)
- "Does the API match how users think?" (Kent C. Dodds)
- "How fast is first success?" (Lee Robinson)

### O que isso significa para o Ultra Media

15 anos de experiência com players geraram **convicções fortes**. Essas convicções são a vantagem competitiva — mas só se estiverem codificadas. Caso contrário, ficam na cabeça do CTO e se perdem quando o agente AI ou um futuro contribuidor toma decisões.

**Exemplos de convicções que precisam ser explicitadas:**

- "SDKs de streaming não devem ser bundled — carregamento sob demanda é inegociável"
- "Um player que não funciona como `<video>` nativo não é um web component de verdade"
- "DRM não deveria exigir 50 linhas de configuração"
- "O desenvolvedor não deveria precisar saber se o stream é HLS ou DASH — o player detecta"
- "Ads são uma realidade do mercado, não um afterthought — mas nunca devem degradar a experiência base"

**Como usar:**

Cada decisão técnica passa por essas lentes. Quando o agente AI precisa decidir entre duas abordagens, ele consulta essas convicções. Quando um contribuidor abre um PR, o review avalia contra essas convicções.

### Ação

Levantar e documentar as convicções do CTO sobre players de vídeo — o que funciona, o que não funciona, o que é inegociável. Transformar experiência tácita em critérios explícitos e reproduzíveis.

---

## 3. Design Rationale — Cada Decisão tem um Porquê

### O que o Video.js 10 faz

Mantém `internal/design/` com Design Docs para decisões significativas (slice-based store, destroy lifecycle, feature availability, reactive element Lit compat). Cada documento explica o problema, a solução, as alternativas consideradas, e o racional.

### O que isso significa para o Ultra Media

Um projeto de autoridade não pode ter decisões "porque sim". Cada escolha arquitetural precisa de um argumento técnico fundamentado. Quando alguém pergunta "por que não Shadow DOM?", a resposta é um raciocínio — não uma preferência.

**Decisões que precisam de rationale documentado:**

- **Light DOM vs Shadow DOM** — Por que `<ultra-media>` não usa Shadow DOM? Qual é a vantagem concreta? O que se perde?
- **`super-media-element` como base** — Por que estender ao invés de construir do zero? Quais trade-offs?
- **Factory pattern para players** — Por que `PlayerFactory → detectFormat() → Player` ao invés de subclasses ou strategy pattern?
- **CDN loading de SDKs** — Por que carregar hls.js e dash.js de CDN dinamicamente ao invés de bundlar? E se o CDN cair?
- **Proxy pattern para YouTube** — Por que emular HTMLMediaElement sobre a YouTube IFrame API? Quais limitações?
- **Plugin system via PluginManager** — Por que um sistema de plugins? Por que não composição funcional como o Video.js 10?
- **Enum para formatos** — Por que `Format.HLS` ao invés de strings? Quando isso ajuda vs. limita?

**O formato ideal:**

```markdown
## Decisão: Light DOM para <ultra-media>

### Problema
Shadow DOM encapsula estilos e DOM, mas impede que estilos externos afetem o player.
Para um player de vídeo que precisa se integrar ao design do site host, isso é um problema.

### Decisão
Usar light DOM com slotted <video> via super-media-element.

### Alternativas consideradas
- Shadow DOM com CSS custom properties → verboso, não cobre todos os casos
- Shadow DOM com adoptedStyleSheets → exige API adicional, não suportado em todos browsers
- Sem custom element (plain JS) → perde declaratividade HTML

### Racional
Players de vídeo são inerentemente parte do layout da página.
Encapsulamento CSS é útil para componentes isolados (botões, modais),
mas prejudica componentes que precisam se adaptar ao contexto visual.
```

### Ação

Documentar o rationale das decisões arquiteturais existentes. Não precisa ser tudo de uma vez — começar pelas decisões que mais frequentemente geram perguntas.

---

## 4. Anti-Patterns da Indústria

### O que o Video.js 10 faz

Documenta anti-patterns de **código** — function overloads, runtime plugin registration, boolean traps. São padrões genéricos de engenharia de software.

### O que isso significa para o Ultra Media

Para um projeto que propõe **outro paradigma**, o conceito mais poderoso é documentar **anti-patterns da indústria de players** — os erros que os concorrentes cometem e que o Ultra Media resolve conscientemente.

**Anti-patterns a documentar:**

**Players monolíticos:**
- Video.js 7/8: tudo é um "component" no sentido interno deles — até um botão de play é uma subclasse de Component. Árvore de herança profunda, difícil de estender sem entender a hierarquia inteira.
- JW Player: configuração por objeto gigante com centenas de opções. Funciona, mas é o oposto de progressive disclosure.

**Abstração prematura de streaming:**
- Shaka Player: abstrai streaming em nível acadêmico (manifest parsing, segment management, network engine, ABR). Para 90% dos casos de uso, a complexidade não se justifica — o dev só quer dar play num HLS.
- Ultra Media approach: delegar streaming para hls.js/dash.js, focar em **a experiência do desenvolvedor**, não no parsing de manifests.

**Plugin ecosystems que ninguém usa:**
- Video.js plugins: registro global, acoplamento com ciclo de vida do player, difícil de testar isoladamente. O ecossistema de plugins cresceu mas a maioria é abandonada.
- Plyr: extensibilidade limitada a theming. Bonito, mas se você precisa de algo além do default, está preso.

**Ignorar o `<video>` nativo:**
- Players que criam sua própria API para play/pause/volume ao invés de delegar ao `<video>` nativo. Força o dev a aprender uma API proprietária ao invés de usar conhecimento existente de HTMLMediaElement.

**DRM como afterthought:**
- Quase todo player open-source trata DRM como "avançado" ou "enterprise". Na realidade, qualquer projeto com conteúdo protegido precisa de DRM desde o dia 1. O Ultra Media trata DRM como plugin de primeira classe, não como documentação escondida.

**Ads bolted-on:**
- Players que adicionam suporte a ads como pensamento posterior. Resulta em conflitos de estado (quem controla o <video>?), timing issues, e UX degradada durante transições content ↔ ad.

### Ação

Criar um documento interno "O que a indústria erra" — não para publicação, mas como referência que guia decisões de design. Quando uma decisão precisar ser tomada, consultar: "estamos repetindo um erro que já vimos?"

---

## 5. Review com Critérios de Autoridade

### O que o Video.js 10 faz

O sistema de review avalia código contra princípios genéricos de engenharia: type safety, DX, a11y, bundle size. Usa 4 sub-agentes especializados em paralelo.

### O que isso significa para o Ultra Media

Para um projeto de autoridade, o review deveria avaliar contra **os critérios do paradigma** — não critérios genéricos. Cada PR precisa responder:

**Critérios do paradigma Ultra Media:**

1. **Compatibilidade nativa** — Esse código mantém compatibilidade com `<video>` nativo? O desenvolvedor pode trocar `<video>` por `<ultra-media>` sem mudar mais nada?

2. **Zero-config para o caso comum** — Esse plugin/feature funciona sem configuração para o cenário mais frequente? Se o dev precisa de mais de 3 linhas para o caso básico, algo está errado.

3. **Bundle discipline** — O bundle size aumentou? O SDK está sendo carregado on-demand? Estamos bundlando algo que deveria ser dinâmico?

4. **Time to first play** — Um dev que nunca viu o projeto consegue usar isso em 2 minutos? Copiar o exemplo do README, colar, funcionar.

5. **Degradação graceful** — Se hls.js não carregar, o player ainda tenta o nativo. Se o YouTube API falhar, o erro é claro. Nenhuma falha deveria ser silenciosa ou catastrófica.

6. **Integração, não acoplamento** — Plugins se comunicam via hooks, não via acesso direto ao estado interno. Remover um plugin nunca deveria quebrar o player.

7. **Respeito ao padrão** — Events seguem CustomEvent/MediaEvent. Atributos seguem convenções HTML. O custom element é cidadão de primeira classe da plataforma web, não um framework disfarçado.

### Ação

Codificar esses critérios em um formato que o agente AI possa usar durante reviews. Não precisa ser um sistema multi-agente complexo — uma checklist contra esses 7 critérios já transforma a qualidade dos PRs.

---

## Resumo Executivo

| Conceito | O que te dá | Prioridade |
|----------|-------------|------------|
| API Design como Filosofia | Consistência em cada decisão de interface | Alta |
| Practitioner Voices (convicções codificadas) | Experiência de 15 anos reproduzível pelo agente AI | Alta |
| Design Rationale | Argumento técnico para cada decisão arquitetural | Média |
| Anti-Patterns da Indústria | Posicionamento consciente contra o status quo | Média |
| Review com critérios próprios | Todo PR reforça o paradigma | Média-Alta |

### Ordem de implementação sugerida

1. **Convicções codificadas** — levantar e documentar as convicções do CTO. É o insumo para tudo que vem depois.
2. **Critérios de review** — transformar convicções em checklist avaliável. Retorno imediato em qualidade.
3. **API Design Manifesto** — formalizar princípios. Guia decisões futuras.
4. **Design Rationale** — documentar decisões já tomadas. Previne regressões.
5. **Anti-Patterns da Indústria** — posicionamento. Útil para comunicação externa (blog, talks) além do desenvolvimento.

### Diferencial vs. Video.js 10

O Video.js 10 usa AI para manter consistência **técnica** — code patterns, type safety, DX genérica. O Ultra Media deve usar AI para manter consistência de **visão** — um paradigma específico sobre como players de vídeo deveriam funcionar, fundamentado em experiência real.

Quando o agente AI avalia uma decisão no Video.js 10, ele pergunta: "isso segue boas práticas?" Quando o agente AI avalia uma decisão no Ultra Media, ele deveria perguntar: **"isso materializa o paradigma que estamos propondo?"**

Essa é a diferença entre engenharia de qualidade e engenharia com propósito.
