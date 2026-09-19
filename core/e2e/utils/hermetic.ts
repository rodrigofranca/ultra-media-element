import { test as base, expect } from '@playwright/test';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CORE_ROOT = path.resolve(__dirname, '..', '..');

// Must match src/core/sdk-config.ts exactly - intercepted and served from the
// pinned devDependency copies below so hermetic runs never touch a real CDN.
const HLS_JS_SDK_URL = 'https://cdn.jsdelivr.net/npm/hls.js@1.7.3/dist/hls.min.js';
const DASHJS_SDK_URL = 'https://cdn.jsdelivr.net/npm/dashjs@5.2.1/dist/modern/umd/dash.all.min.js';

const LOCAL_SDK_FILES: Record<string, string> = {
  [HLS_JS_SDK_URL]: path.join(CORE_ROOT, 'node_modules/hls.js/dist/hls.min.js'),
  [DASHJS_SDK_URL]: path.join(CORE_ROOT, 'node_modules/dashjs/dist/modern/umd/dash.all.min.js'),
};

const ALLOWED_HOSTS = new Set(['localhost', '127.0.0.1']);

/**
 * Every hermetic spec (anything not tagged @network) uses this `test`
 * instead of the bare Playwright one. It's an `auto` fixture: just importing
 * it is enough to block/record any request that isn't to the local static
 * server or to the two pinned SDK URLs above (which get served from disk
 * instead). If a violation is recorded, the test fails - this is what
 * proves `pnpm e2e` never touches a real network.
 */
export const test = base.extend<{ hermeticGuard: void; pageErrors: string[] }>({
  hermeticGuard: [
    async ({ page }, use) => {
      const violations: string[] = [];

      await page.route('**/*', async (route) => {
        const url = route.request().url();
        const localFile = LOCAL_SDK_FILES[url];

        if (localFile) {
          await route.fulfill({
            status: 200,
            contentType: 'application/javascript; charset=utf-8',
            body: fs.readFileSync(localFile),
          });
          return;
        }

        let hostname: string;
        try {
          hostname = new URL(url).hostname;
        } catch {
          await route.continue();
          return;
        }

        if (ALLOWED_HOSTS.has(hostname)) {
          await route.continue();
          return;
        }

        violations.push(url);
        await route.abort('blockedbyclient');
      });

      await use();

      expect(violations, `hermetic run must not reach non-local hosts, got: ${violations.join(', ')}`).toEqual([]);
    },
    { auto: true },
  ],

  // Every spec gets this for free: no test should ever leave an unhandled
  // exception on the page, even the ones that expect a player `error` event.
  pageErrors: [
    async ({ page }, use) => {
      const errors: string[] = [];
      page.on('pageerror', (err) => errors.push(String(err)));

      await use(errors);

      expect(errors, `no unhandled exceptions expected on the page, got: ${errors.join(', ')}`).toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };
