#!/usr/bin/env node
/**
 * Bundles the two media-chrome devDependency entry points the e2e harness
 * needs (`media-chrome`, `media-chrome/menu`) into a single ES module.
 *
 * result-cycle2.md's diagnosis: media-chrome-player.html previously loaded
 * these as native, unbundled ESM (`/media-chrome/index.js` +
 * `/media-chrome/menu/index.js`), which the browser resolves as ~70 separate
 * relative-import requests per page. That request burst, multiplied by
 * Playwright's parallel workers, was the trigger for the static server's
 * synchronous-I/O stalls (see static-server.mjs). Bundling to one file cuts
 * that to a single request, independent of the server fix - see
 * result-cycle2.md's "antes -> depois" table for both contributions
 * measured separately.
 *
 * Runs once, via Playwright's `globalSetup` (e2e/playwright.config.ts) - not
 * per worker - so this always happens before tests start regardless of how
 * `playwright test` is invoked, and is a plain synchronous cost paid once,
 * not per test/page.
 */
import path from 'node:path';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CORE_ROOT = path.resolve(__dirname, '..', '..');
const OUT_DIR = path.join(CORE_ROOT, 'e2e', '.generated');
const ENTRY_FILE = path.join(OUT_DIR, '_media-chrome-entry.mjs');
const BUNDLE_NAME = 'media-chrome-bundle.js';

export async function bundleMediaChrome() {
  await fs.mkdir(OUT_DIR, { recursive: true });
  await fs.writeFile(ENTRY_FILE, "import 'media-chrome';\nimport 'media-chrome/menu';\n");

  await build({
    root: CORE_ROOT,
    configFile: false,
    logLevel: 'warn',
    build: {
      outDir: OUT_DIR,
      emptyOutDir: false,
      minify: false,
      lib: {
        entry: ENTRY_FILE,
        formats: ['es'],
        fileName: () => BUNDLE_NAME,
      },
      rollupOptions: {
        // No entry here imports anything outside media-chrome itself (its
        // /react subpath is never reached from `.`/`./menu`) - a plain
        // single-chunk bundle, no externals to configure.
        output: { inlineDynamicImports: true },
      },
    },
  });

  await fs.rm(ENTRY_FILE, { force: true });
}

// Default export: what Playwright's `globalSetup` config option calls.
export default bundleMediaChrome;

if (import.meta.url === `file://${process.argv[1]}`) {
  await bundleMediaChrome();
  console.log(`media-chrome bundled to e2e/.generated/${BUNDLE_NAME}`);
}
