import { describe, it, expect, afterAll } from '@jest/globals';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

/**
 * ADR-0001's dependency rule for the headless core: nothing under
 * `src/core-entry.ts`'s import graph may pull in `super-media-element`,
 * `media-tracks`, the element/ad shells, or use Custom Elements, Shadow
 * DOM, `ResizeObserver`, the `EventTarget` constructor, or `#` private
 * class fields (the oldest Smart TV runtimes this targets may lack all of
 * those). This is a *source*-level static walk (works without a prior
 * `pnpm build`); `dist/ultra-media-core.es.js`'s actual bundled content is
 * checked separately by `scripts/check-core-isolation.mjs`, part of
 * `pnpm size`, which also catches anything tree-shaking might otherwise
 * hide or reveal.
 */
const SRC_ROOT = path.resolve(__dirname, '..', 'src');
const ENTRY = path.join(SRC_ROOT, 'core-entry.ts');

const FORBIDDEN_BARE_IMPORTS = ['super-media-element', 'media-tracks'];
const FORBIDDEN_LOCAL_FILES = ['ultra-media-element.ts', 'ultra-media-ad.ts'];
const FORBIDDEN_API_PATTERNS: Array<{ name: string; pattern: RegExp }> = [
  { name: 'customElements', pattern: /\bcustomElements\b/ },
  { name: 'attachShadow', pattern: /\battachShadow\b/ },
  { name: 'ResizeObserver', pattern: /\bResizeObserver\b/ },
  { name: 'new EventTarget()', pattern: /\bnew\s+EventTarget\s*\(/ },
  // Private class field declaration (its own token, class-body position)
  // or access (`this.#foo`) - deliberately narrow patterns so real code
  // like log.ts's `'#353535'` hex-color string literals don't false-positive.
  { name: 'private class field declaration (#foo)', pattern: /^\s*#[a-zA-Z_$]/m },
  { name: 'private class field access (this.#foo)', pattern: /\bthis\.#[a-zA-Z_$]/ },
];

// Three distinct, non-overlapping syntactic forms a module specifier can
// appear in - `import X from '…'`/`export … from '…'` all require a
// `from` clause; a bare side-effect `import '…'` never has one; a dynamic
// `import('…')` is a call expression, not a declaration (cycle 2, defect 6
// - the guard used to only recognize the first form).
const IMPORT_SPECIFIER_PATTERNS: RegExp[] = [
  /(?:import|export)\s[^;]*?\sfrom\s+['"]([^'"]+)['"]/g,
  /import\s+['"]([^'"]+)['"]/g,
  /\bimport\(\s*['"]([^'"]+)['"]/g,
];

// Strips comments before checking for forbidden API usage, so a doc
// comment that merely *mentions* one of these APIs (as this file's own
// source does, and as ultra-media-core.ts's dependency-rule comment does)
// doesn't trip the guard. Good enough for this codebase's style; not a
// general-purpose JS/TS parser.
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

function resolveLocalImport(fromFile: string, specifier: string): string | null {
  if (!specifier.startsWith('.')) return null;
  const base = path.resolve(path.dirname(fromFile), specifier);
  for (const candidate of [base, `${base}.ts`, path.join(base, 'index.ts')]) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
  }
  return null;
}

interface WalkResult {
  files: Set<string>;
  bareImportViolations: Array<{ file: string; specifier: string }>;
  localFileViolations: Array<{ file: string; imported: string }>;
}

function walkImportGraph(entry: string): WalkResult {
  const files = new Set<string>();
  const bareImportViolations: WalkResult['bareImportViolations'] = [];
  const localFileViolations: WalkResult['localFileViolations'] = [];
  const queue = [entry];

  while (queue.length > 0) {
    const file = queue.pop()!;
    if (files.has(file)) continue;
    files.add(file);

    const source = fs.readFileSync(file, 'utf8');
    for (const pattern of IMPORT_SPECIFIER_PATTERNS) {
      for (const match of source.matchAll(pattern)) {
        const specifier = match[1];

        if (FORBIDDEN_BARE_IMPORTS.some((forbidden) => specifier === forbidden || specifier.startsWith(`${forbidden}/`))) {
          bareImportViolations.push({ file, specifier });
          continue;
        }

        const resolved = resolveLocalImport(file, specifier);
        if (!resolved) continue; // other npm packages are fine to *reference* here; none are actually used besides the two forbidden ones checked above

        if (FORBIDDEN_LOCAL_FILES.includes(path.basename(resolved))) {
          localFileViolations.push({ file, imported: path.basename(resolved) });
          continue;
        }

        queue.push(resolved);
      }
    }
  }

  return { files, bareImportViolations, localFileViolations };
}

describe('UltraMediaCore dependency guard (ADR-0001)', () => {
  const { files, bareImportViolations, localFileViolations } = walkImportGraph(ENTRY);

  it('walked more than just the entry file (sanity check the graph isn\'t trivially empty)', () => {
    expect(files.size).toBeGreaterThan(5);
  });

  it('never imports super-media-element or media-tracks', () => {
    expect(bareImportViolations).toEqual([]);
  });

  it('never imports the <ultra-media>/<ultra-media-ad> shells', () => {
    expect(localFileViolations).toEqual([]);
  });

  it('never uses customElements / attachShadow / ResizeObserver / new EventTarget() / #private fields', () => {
    const violations: Array<{ file: string; api: string }> = [];
    for (const file of files) {
      const source = stripComments(fs.readFileSync(file, 'utf8'));
      for (const { name, pattern } of FORBIDDEN_API_PATTERNS) {
        if (pattern.test(source)) {
          violations.push({ file: path.relative(SRC_ROOT, file), api: name });
        }
      }
    }
    expect(violations).toEqual([]);
  });
});

describe('UltraMediaCore dependency guard: catches every import form (cycle 2, defect 6)', () => {
  // Real (temporary, self-cleaning) files under a scratch dir, walked
  // through the actual `walkImportGraph`/regex this guard uses in
  // production - not a copy - so this exercises the real detection logic,
  // not just a description of it. Each violation is a bare import of a
  // real forbidden package, written in a different syntactic form.
  const scratchDir = fs.mkdtempSync(path.join(os.tmpdir(), 'core-dependency-guard-test-'));
  afterAll(() => fs.rmSync(scratchDir, { recursive: true, force: true }));

  function writeEntry(name: string, content: string): string {
    const entry = path.join(scratchDir, `${name}.ts`);
    fs.writeFileSync(entry, content, 'utf8');
    return entry;
  }

  it('catches a bare side-effect import: import \'…\'', () => {
    const entry = writeEntry('side-effect', `import 'super-media-element';\n`);
    expect(walkImportGraph(entry).bareImportViolations).toEqual([{ file: entry, specifier: 'super-media-element' }]);
  });

  it('catches a re-export: export … from \'…\'', () => {
    const entry = writeEntry('re-export', `export * from 'media-tracks';\n`);
    expect(walkImportGraph(entry).bareImportViolations).toEqual([{ file: entry, specifier: 'media-tracks' }]);
  });

  it('catches a dynamic import: import(\'…\')', () => {
    const entry = writeEntry('dynamic', `export const load = () => import('super-media-element');\n`);
    expect(walkImportGraph(entry).bareImportViolations).toEqual([{ file: entry, specifier: 'super-media-element' }]);
  });
});
