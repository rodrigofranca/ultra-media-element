# Plano de Ação: Compatibilidade Svelte+Vite

**Data:** 10/03/2026
**Objetivo:** Corrigir problemas de compatibilidade e consumo do `@rodrigofranca/ultra-media` em projetos Svelte+Vite (npm e CDN).

---

## Problemas Identificados

| # | Problema | Severidade |
|---|---|---|
| 1 | `exports` aponta para arquivo inexistente (`ultra-media.es.js` vs `ultra-media-element.es.js`) | Crítico |
| 2 | `types/global.d.ts` importa de `'ultra-media-element'` (módulo inexistente) | Crítico |
| 3 | CDN URL incorreta no README (nome e versão do pacote errados) | Crítico |
| 4 | JSX types incompatíveis com Svelte (`JSX.IntrinsicElements` vs `svelteHTML`) | Importante |
| 5 | SSR incompatível — sem guards para ambiente Node.js (SvelteKit) | Importante |
| 6 | `console.log` de debug ativo em produção | Importante |
| 7 | `media-tracks` não declarado em `dependencies` | Menor |
| 8 | `attachShadow` chamado em `connectedCallback` — quebra ao reinserir no DOM | Menor |

---

## Tarefas

### FASE 1 — Correções Críticas (package.json + types)

#### 1.1 Corrigir o nome do arquivo gerado no build
**Arquivo:** `core/vite.config.ts`
**Problema:** `packageName = 'ultra-media-element'` gera `ultra-media-element.es.js`, mas `package.json` espera `ultra-media.es.js`.
**Ação:** Alinhar o `packageName` com o campo `name` do `package.json`, ou ajustar o `exports` do `package.json` para apontar para o arquivo correto.

**Opção A** — ajustar `vite.config.ts` (recomendado):
```ts
const packageName = 'ultra-media'; // era 'ultra-media-element'
```

**Opção B** — ajustar `package.json`:
```json
"exports": { ".": { "import": "./dist/ultra-media-element.es.js" } },
"module": "./dist/ultra-media-element.es.js"
```

---

#### 1.2 Corrigir a importação de tipos em `global.d.ts`
**Arquivo:** `core/types/global.d.ts`
**Problema:** `import type { UltraMediaElement } from 'ultra-media-element'` — módulo não existe.
**Ação:** Corrigir para o nome real do pacote:
```ts
import type { UltraMediaElement } from '@rodrigofranca/ultra-media';
```
> Nota: Se o tipo for gerado no `dist/`, ajustar para importar do caminho relativo correto ou garantir que `dist/index.d.ts` re-exporta o tipo.

---

#### 1.3 Corrigir CDN URL no README
**Arquivo:** `core/README.md`
**Problema:** URL usa `ultra-media@4` com pacote `@rodrigofranca/ultra-media@0.0.1`.
**Ação:** Atualizar com nome e versão corretos, e validar que o arquivo referenciado existe após o build:
```html
<script type="module" src="https://cdn.jsdelivr.net/npm/@rodrigofranca/ultra-media/+esm"></script>
```
> Validar o link após o fix do item 1.1.

---

### FASE 2 — Compatibilidade com Svelte

#### 2.1 Adicionar tipos para Svelte
**Arquivo:** `core/types/global.d.ts`
**Problema:** `JSX.IntrinsicElements` é ignorado pelo compilador Svelte.
**Ação:** Adicionar declaração compatível com Svelte 4 e 5:
```ts
// Svelte 4
declare namespace svelteHTML {
  interface IntrinsicElements {
    'ultra-media': { src?: string; controls?: boolean; autoplay?: boolean; muted?: boolean; [key: string]: any };
    'ultra-media-ad': { video?: string; 'ad-tag-url'?: string; 'mute-only'?: boolean; [key: string]: any };
  }
}

// Svelte 5
declare module 'svelte/elements' {
  interface SvelteHTMLElements {
    'ultra-media': HTMLAttributes<HTMLElement> & { src?: string; controls?: boolean; autoplay?: boolean; muted?: boolean };
    'ultra-media-ad': HTMLAttributes<HTMLElement> & { video?: string; 'ad-tag-url'?: string; 'mute-only'?: boolean };
  }
}
```

---

#### 2.2 Documentar uso com SSR (SvelteKit)
**Arquivo:** `core/README.md`
**Problema:** O pacote usa APIs de browser (DOM, `customElements`, `ResizeObserver`) que não existem em Node.js.
**Ação A (documentação):** Adicionar seção no README com instrução de import lazy:
```ts
// +page.svelte ou qualquer componente Svelte
import { onMount } from 'svelte';
onMount(async () => {
  await import('@rodrigofranca/ultra-media');
});
```
**Ação B (opcional, mais robusto):** Avaliar adicionar guards de SSR nos pontos críticos do código (principalmente `ultra-media-ad.ts` onde `document` é acessado diretamente sem proteção).

---

### FASE 3 — Qualidade e Robustez

#### 3.1 Remover `console.log` de produção
**Arquivo:** `core/src/ultra-media-element.ts:55`
**Problema:** Log disparado para toda mudança de atributo, inclusive em produção.
**Ação:** Remover ou substituir pelo utilitário `log.ts` já existente no projeto, que pode ser condicionado ao modo debug.

---

#### 3.2 Adicionar `media-tracks` nas `dependencies`
**Arquivo:** `core/package.json`
**Problema:** `media-tracks` é importado no código mas não declarado como dependência.
**Ação:**
```bash
pnpm add media-tracks
```
Verificar a versão usada pela `super-media-element` para evitar conflito.

---

#### 3.3 Corrigir `attachShadow` no `UltraMediaAd`
**Arquivo:** `core/src/ultra-media-ad.ts:29`
**Problema:** `attachShadow` chamado em `connectedCallback` lança `DOMException` se o elemento for reinserido no DOM (comum com `{#if}` no Svelte).
**Ação:** Mover `attachShadow` para o `constructor` ou adicionar guard:
```ts
connectedCallback() {
  if (!this.shadowRoot) {
    this.attachShadow({ mode: 'open' });
    this.injectStyle();
  }
  // ... resto do código
}
```

---

## Ordem de Execução

```
FASE 1 (crítico, fazer primeiro)
  └─ 1.1 → 1.2 → 1.3
        └─ rebuild + validar CDN link

FASE 2 (Svelte)
  └─ 2.1 → 2.2

FASE 3 (qualidade)
  └─ 3.1, 3.2, 3.3 (paralelo)
```

---

## Status de Conclusão

### ✅ FASE 1 — Correções Críticas (COMPLETO)

- [x] **1.1** Corrigir `packageName` em `vite.config.ts`
  - Alterado de `'ultra-media-element'` para `'ultra-media'`
  - Build agora gera `ultra-media.es.js` e `ultra-media.umd.js` corretamente

- [x] **1.2** Corrigir importação em `types/global.d.ts`
  - Alterado de `import type { UltraMediaElement } from 'ultra-media-element'`
  - Para `import type { UltraMediaElement } from '@rodrigofranca/ultra-media'`

- [x] **1.3** Corrigir CDN URL no README
  - Atualizado de `https://cdn.jsdelivr.net/npm/ultra-media@4/+esm`
  - Para `https://cdn.jsdelivr.net/npm/@rodrigofranca/ultra-media/+esm`
  - NPM install: `npm install @rodrigofranca/ultra-media`

### ✅ FASE 2 — Compatibilidade com Svelte (COMPLETO)

- [x] **2.1** Adicionar tipos para Svelte
  - Declaração `svelteHTML` adicionada (Svelte 4)
  - Declaração `svelte/elements` adicionada (Svelte 5)
  - Ambos os componentes (`ultra-media` e `ultra-media-ad`) com tipos completos

- [x] **2.2** Documentar uso com SSR (SvelteKit)
  - Seção adicionada ao README com exemplo de `onMount` + import dinâmico
  - Instrução clara sobre uso com SSR

### ✅ FASE 3 — Qualidade e Robustez (COMPLETO)

- [x] **3.1** Remover `console.log` de produção
  - Removido log em `ultra-media-element.ts:55` do `attributeChangedCallback`

- [x] **3.2** Adicionar `media-tracks` nas `dependencies`
  - Executado `pnpm add media-tracks` (v0.3.4)
  - Agora declarado em `package.json`

- [x] **3.3** Corrigir `attachShadow` no `UltraMediaAd`
  - Adicionado guard: `if (!this.shadowRoot)` em `connectedCallback`
  - Elemento agora suporta reinserção no DOM via `{#if}`

## Validação Final

Build e validação concluídos:

- [x] Build executado com sucesso (`pnpm build`)
- [x] Arquivos gerados com nomes corretos:
  - `dist/ultra-media.es.js` (139 KB)
  - `dist/ultra-media.umd.js` (75 KB)
  - `dist/index.d.ts` (tipos exportados)
- [x] `console.log` de debug removido
- [x] TypeScript types exportados corretamente
- [x] Svelte 4 e 5 compatíveis (types definidos)
- [x] SSR/SvelteKit documentado no README

### Próximos Passos (Optional)

Para validação em projeto real:
- [ ] Testar em projeto Svelte+Vite existente com `npm install @rodrigofranca/ultra-media`
- [ ] Validar CDN URL em browser (https://cdn.jsdelivr.net/npm/@rodrigofranca/ultra-media/+esm)
- [ ] Testar `<ultra-media-ad>` com `{#if}` no Svelte para confirmar reinserção no DOM
