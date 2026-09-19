import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

/**
 * scripts/check-core-isolation.mjs is a bundle-content grep run by `pnpm
 * size` - this exercises the real script (not a copy of its logic) against
 * synthetic dist/ files in a scratch cwd, so it needs no prior `pnpm build`.
 * Cycle 3, defect 4: extends ADR-0001's original marker list (Custom
 * Elements/Shadow DOM/Mux packages) with every other global the ~ES2017
 * Smart TV target may lack - this is the "prova: violação temporária
 * detectada" the brief asks for, done as a permanent regression test
 * instead of a one-off manual check.
 */
const SCRIPT = path.resolve(__dirname, '..', 'scripts', 'check-core-isolation.mjs');

const NEW_MARKERS = [
  'queueMicrotask',
  'structuredClone',
  'IntersectionObserver',
  'replaceAll',
  '.at(',
  'Object.hasOwn',
];

function runGuard(cwd: string): { status: number; output: string } {
  try {
    const output = execFileSync('node', [SCRIPT], { cwd, encoding: 'utf8' });
    return { status: 0, output };
  } catch (error) {
    const e = error as { status?: number; stdout?: string; stderr?: string };
    return { status: e.status ?? 1, output: `${e.stdout ?? ''}${e.stderr ?? ''}` };
  }
}

function writeBundles(cwd: string, esContent: string, umdContent = esContent): void {
  const distDir = path.join(cwd, 'dist');
  fs.mkdirSync(distDir, { recursive: true });
  fs.writeFileSync(path.join(distDir, 'ultra-media-core.es.js'), esContent, 'utf8');
  fs.writeFileSync(path.join(distDir, 'ultra-media-core.umd.cjs'), umdContent, 'utf8');
}

describe('check-core-isolation.mjs: forbidden-global markers (cycle 3, defect 4)', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'check-core-isolation-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('exits 0 on a clean bundle with none of the forbidden markers', () => {
    writeBundles(tmpDir, 'export class UltraMediaCore {}\n');
    const { status } = runGuard(tmpDir);
    expect(status).toBe(0);
  });

  it.each(NEW_MARKERS)('flags "%s" when present as real code in the ES bundle', (marker) => {
    writeBundles(tmpDir, `export class UltraMediaCore {}\nconst x = ${JSON.stringify(marker)};\n`);
    const { status, output } = runGuard(tmpDir);
    expect(status).toBe(1);
    expect(output).toContain(marker);
  });

  // A comment merely *mentioning* a forbidden API (this file's own doc
  // comment above does, and so does the script's) must not trip the guard -
  // the same false-positive class tests/core-dependency-guard.test.ts's
  // stripComments() already guards against for the source-level walk.
  it.each(NEW_MARKERS)('does not flag "%s" when it only appears in a comment', (marker) => {
    writeBundles(tmpDir, `export class UltraMediaCore {}\n// mentions ${marker} in prose, not code\n/* also here: ${marker} */\n`);
    const { status } = runGuard(tmpDir);
    expect(status).toBe(0);
  });

  it('flags a marker present only in the UMD bundle, not just the ES one', () => {
    writeBundles(tmpDir, 'export class UltraMediaCore {}\n', 'var UltraMediaCore = (function(){ return queueMicrotask; })();\n');
    const { status, output } = runGuard(tmpDir);
    expect(status).toBe(1);
    expect(output).toContain('queueMicrotask');
    expect(output).toContain('ultra-media-core.umd.cjs');
  });

  it('still catches the original ADR-0001 markers (customElements, attachShadow, ResizeObserver, new EventTarget()', () => {
    for (const marker of ['customElements', 'attachShadow', 'ResizeObserver', 'new EventTarget(']) {
      writeBundles(tmpDir, `const x = ${JSON.stringify(marker)};\n`);
      const { status, output } = runGuard(tmpDir);
      expect(status).toBe(1);
      expect(output).toContain(marker);
    }
  });

  // globalThis is special-cased, not a plain substring marker: every UMD
  // bundle Rollup emits (ours included) carries
  // `typeof globalThis!="undefined"?globalThis:c||self` as its own
  // environment-detection boilerplate - already the guarded self/window-
  // fallback pattern this rule wants, not a violation of it.
  describe('globalThis: only an unguarded reference is a violation', () => {
    it('does not flag Rollup\'s own UMD wrapper pattern (typeof globalThis!="undefined"?globalThis:self)', () => {
      writeBundles(
        tmpDir,
        'export class UltraMediaCore {}\n',
        '(function(g,f){typeof exports=="object"?f(exports):(g=typeof globalThis!="undefined"?globalThis:g||self,f(g.x={}))})(this,function(x){});\n'
      );
      const { status } = runGuard(tmpDir);
      expect(status).toBe(0);
    });

    it('flags an unguarded globalThis reference (not immediately preceded by typeof)', () => {
      writeBundles(tmpDir, 'export class UltraMediaCore {}\nconst x = globalThis.foo;\n');
      const { status, output } = runGuard(tmpDir);
      expect(status).toBe(1);
      expect(output).toContain('globalThis');
    });
  });
});
