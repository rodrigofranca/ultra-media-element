import { describe, it, expect } from '@jest/globals';
import { createRequire } from 'node:module';
import path from 'node:path';
import fs from 'node:fs';

// package.json sets "type": "module", so a plain `.js` file is always ESM
// to Node's resolver regardless of its actual (CJS/UMD) content -
// require()-ing one either throws ERR_REQUIRE_ESM or (newer Node,
// require(esm) support) silently loads it as an ESM namespace, in both
// cases never reaching the UMD wrapper's own `typeof module !== 'undefined'`
// CJS branch. `dist/*.umd.cjs` (not `.js`) fixes that - `.cjs` is
// unconditionally CommonJS to Node. Requires a prior `pnpm build`.
// See result-cycle2.md, defect 5.
const DIST = path.resolve(__dirname, '..', 'dist');
const requireFromDist = createRequire(path.join(DIST, 'require-entries-test.cjs'));

function distFile(name: string): string {
  const file = path.join(DIST, name);
  if (!fs.existsSync(file)) {
    throw new Error(`${file} does not exist - run "pnpm build" before this test`);
  }
  return file;
}

describe('CJS require() of the published UMD entries (cycle 2, defect 5)', () => {
  it('require()-ing the /core entry by its package-relative dist path returns UltraMediaCore as a function', () => {
    const mod = requireFromDist(distFile('ultra-media-core.umd.cjs'));
    expect(typeof mod.UltraMediaCore).toBe('function');
  });

  // `.`/`./ad` register a Custom Element as a side effect (guarded: a
  // no-op when `customElements` doesn't exist - see
  // src/utils/register-custom-element.ts) and assume a DOM otherwise; the
  // only thing this proves is that require() reaches real module code at
  // all - a module-format error (the actual defect) throws before a single
  // line of that code runs, so any *other* kind of failure here is
  // evidence the fix worked, not a reason to fail this test.
  it.each([
    ['.', 'ultra-media.umd.cjs'],
    ['./ad', 'ultra-media-ad.umd.cjs'],
  ])('require()-ing the %s entry (%s) is valid CommonJS - no module-syntax error', (_entry, fileName) => {
    const file = distFile(fileName); // missing dist/ is a setup failure, not a module-format one - let it throw plainly

    let thrown: unknown;
    try {
      requireFromDist(file);
    } catch (error) {
      thrown = error;
    }

    if (thrown) {
      const message = String((thrown as Error)?.message ?? thrown);
      expect(message).not.toMatch(/Unexpected token|Cannot use import statement|require is not defined|module is not defined|ERR_REQUIRE_ESM/i);
    }
  });
});
