#!/usr/bin/env node
/**
 * Regression guard for the headless core split (ADR-0001): the `/core`
 * entry (`UltraMediaCore`) must never pull in Custom Elements, Shadow DOM,
 * `super-media-element` or `media-tracks`, directly or transitively. Runs
 * as part of `pnpm size`, after `pnpm build`, against the published dist/
 * artifacts - not source, so it also catches an accidental import that
 * only shows up post-bundling/tree-shaking. The `#` private-field rule
 * isn't checked here (hex color literals like `'#353535'` make bundle-text
 * grepping for `#` unreliable) - see tests/core-dependency-guard.test.ts
 * for that one, done as a source-level import-graph walk instead.
 */
import { readFileSync } from 'node:fs';

const FORBIDDEN_MARKERS = ['customElements', 'attachShadow', 'super-media-element', 'media-tracks', 'ResizeObserver', 'new EventTarget('];
const CORE_BUNDLES = ['dist/ultra-media-core.es.js', 'dist/ultra-media-core.umd.cjs'];

let failed = false;

for (const file of CORE_BUNDLES) {
  const content = readFileSync(file, 'utf8');
  for (const marker of FORBIDDEN_MARKERS) {
    if (content.includes(marker)) {
      console.error(`core isolation violation: "${marker}" found in ${file}`);
      failed = true;
    }
  }
}

if (failed) {
  console.error('\nThe headless core bundle must not depend on Custom Elements/Shadow DOM/Mux packages. See ADR-0001 / AGENTS.md.');
  process.exit(1);
}

console.log('core isolation OK: headless core bundles contain no shell/Mux markers');
