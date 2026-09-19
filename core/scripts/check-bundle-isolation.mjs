#!/usr/bin/env node
/**
 * Regression guard for the core/ads bundle split: the core entry
 * (`<ultra-media>`) must never pull in ad code, directly or transitively.
 * Runs as part of `pnpm size`, after `pnpm build`, against the published
 * dist/ artifacts - not source, so it also catches an accidental import
 * that only shows up post-bundling/tree-shaking.
 */
import { readFileSync } from 'node:fs';

const FORBIDDEN_MARKERS = ['ima-ad-player', 'imasdk', 'ultra-media-ad'];
const CORE_BUNDLES = ['dist/ultra-media.es.js', 'dist/ultra-media.umd.cjs'];

let failed = false;

for (const file of CORE_BUNDLES) {
  const content = readFileSync(file, 'utf8');
  for (const marker of FORBIDDEN_MARKERS) {
    if (content.includes(marker)) {
      console.error(`bundle isolation violation: "${marker}" found in ${file}`);
      failed = true;
    }
  }
}

if (failed) {
  console.error('\nThe core bundle must not contain ad code. See AGENTS.md / README.md "Entry points".');
  process.exit(1);
}

console.log('bundle isolation OK: core bundles contain no ad code');
