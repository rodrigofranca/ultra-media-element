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

// cycle 3, defect 4: the original list only covered ADR-0001's own examples
// (Custom Elements/Shadow DOM/Mux packages). Extended with every other
// ~ES2017-unsafe global the brief called out - none of these exist on the
// oldest Tizen/webOS runtimes `/core` targets either. The `#` private-field
// rule stays out of this list for the same reason as before (hex literals) -
// covered by tests/core-dependency-guard.test.ts's source-level walk
// instead. `globalThis` gets its own check below, not this list - see its
// comment.
const FORBIDDEN_MARKERS = [
  'customElements',
  'attachShadow',
  'super-media-element',
  'media-tracks',
  'ResizeObserver',
  'new EventTarget(',
  'queueMicrotask',
  'structuredClone',
  'IntersectionObserver',
  'replaceAll',
  '.at(',
  'Object.hasOwn',
];
const CORE_BUNDLES = ['dist/ultra-media-core.es.js', 'dist/ultra-media-core.umd.cjs'];

// A plain comment *mentioning* a forbidden API (like the one two lines up,
// or this file's own dependency-rule doc comment) would otherwise
// false-positive a minified-but-comment-preserving bundle - same risk
// tests/core-dependency-guard.test.ts's stripComments() already guards
// against for the source-level walk. The `[^:]` exclusion keeps `://` in a
// bundled URL (e.g. sdk-config.ts's CDN URLs) from being mistaken for a
// line comment.
function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

// `globalThis` can't be a plain substring marker: every UMD bundle Rollup
// emits (including our own ad/element ones, not just /core) carries
// `typeof globalThis!="undefined"?globalThis:c||self` verbatim as its own
// environment-detection boilerplate - already exactly the guarded
// `self`-fallback pattern this rule asks *our* code to use, not a violation
// of it (both the `typeof` check and the reference it guards use the
// identifier). Strip that exact idiom first; any `globalThis` left over is
// a real, unguarded reference our own code introduced.
const GLOBALTHIS_GUARDED_IDIOM = /typeof\s+globalThis\s*(?:!==?|===?)\s*["']undefined["']\s*\?\s*globalThis\s*:/g;

function findUnguardedGlobalThis(content) {
  return content.replace(GLOBALTHIS_GUARDED_IDIOM, '').includes('globalThis');
}

let failed = false;

for (const file of CORE_BUNDLES) {
  const content = stripComments(readFileSync(file, 'utf8'));
  for (const marker of FORBIDDEN_MARKERS) {
    if (content.includes(marker)) {
      console.error(`core isolation violation: "${marker}" found in ${file}`);
      failed = true;
    }
  }
  if (findUnguardedGlobalThis(content)) {
    console.error(`core isolation violation: unguarded "globalThis" (not "typeof globalThis") found in ${file}`);
    failed = true;
  }
}

if (failed) {
  console.error('\nThe headless core bundle must not depend on Custom Elements/Shadow DOM/Mux packages. See ADR-0001 / AGENTS.md.');
  process.exit(1);
}

console.log('core isolation OK: headless core bundles contain no shell/Mux markers');
