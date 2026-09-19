import type { Page } from '@playwright/test';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { test, expect } from '../utils/hermetic';
import { gotoPlayer, setSrc } from '../utils/media';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CORE_ROOT = path.resolve(__dirname, '..', '..');

// Must match hermetic.ts / src/core/sdk-config.ts exactly.
const HLS_JS_SDK_URL = 'https://cdn.jsdelivr.net/npm/hls.js@1.7.3/dist/hls.min.js';
const DASHJS_SDK_URL = 'https://cdn.jsdelivr.net/npm/dashjs@5.2.1/dist/modern/umd/dash.all.min.js';

const SDK_FILES: Record<string, string> = {
  [HLS_JS_SDK_URL]: path.join(CORE_ROOT, 'node_modules/hls.js/dist/hls.min.js'),
  [DASHJS_SDK_URL]: path.join(CORE_ROOT, 'node_modules/dashjs/dist/modern/umd/dash.all.min.js'),
};

// Long enough that destroy()/a src swap/a DOM removal - each just a couple
// of `page.evaluate()` round-trips - is guaranteed to land well before the
// SDK script "finishes loading", opening the race window player-factory.ts
// used to lose (see its and HlsPlayer/DashPlayer's `destroyed`/`pendingSrc`
// comments). Generous margin (rather than e.g. 500ms) because at the
// default e2e parallelism (11 workers) those `page.evaluate()` round-trips
// can themselves take a while under CPU contention - see result.md
// "decisões de design".
const SDK_DELAY_MS = 3000;

/**
 * Registers a route for the given SDK URL that delays the response by
 * SDK_DELAY_MS before serving the real pinned local copy - takes priority
 * over hermetic.ts's own `**\/*` route (Playwright runs the most-recently
 * registered matching handler first), so this is the only thing that
 * answers that request.
 */
async function delaySdkResponse(page: Page, sdkUrl: string): Promise<void> {
  await page.route(sdkUrl, async (route) => {
    await new Promise((resolve) => setTimeout(resolve, SDK_DELAY_MS));
    await route.fulfill({
      status: 200,
      contentType: 'application/javascript; charset=utf-8',
      body: fs.readFileSync(SDK_FILES[sdkUrl]),
    });
  });
}

async function trackRequestUrls(page: Page, glob: string): Promise<string[]> {
  const urls: string[] = [];
  await page.route(glob, async (route) => {
    urls.push(route.request().url());
    await route.continue();
  });
  return urls;
}

const CASES = [
  {
    engine: 'hls',
    sdkUrl: HLS_JS_SDK_URL,
    manifest: '/fixtures/hls/master.m3u8',
    manifestGlob: '**/fixtures/hls/master.m3u8*',
    segmentGlob: '**/fixtures/hls/**/*.m4s',
  },
  {
    engine: 'dash',
    sdkUrl: DASHJS_SDK_URL,
    manifest: '/fixtures/dash/manifest.mpd',
    manifestGlob: '**/fixtures/dash/manifest.mpd*',
    segmentGlob: '**/fixtures/dash/**/*.m4s',
  },
];

test.describe('cancel in-flight player creation while the SDK is still loading', () => {
  for (const { engine, sdkUrl, manifest, manifestGlob, segmentGlob } of CASES) {
    // player-factory.ts used to chain the initial load() onto `onReady`;
    // destroy() clearing `element.player` didn't stop the underlying
    // hls.js/dash.js instance from being created once the (by then
    // irrelevant) CDN script finally loaded, so it went ahead and requested
    // the cancelled manifest/segments anyway.
    test(`destroy() before the SDK finishes loading requests no manifest/segment (${engine})`, async ({ page }) => {
      test.setTimeout(60_000);
      await gotoPlayer(page);
      await delaySdkResponse(page, sdkUrl);
      const manifestRequests = await trackRequestUrls(page, manifestGlob);
      const segmentRequests = await trackRequestUrls(page, segmentGlob);

      await setSrc(page, manifest);
      await page.evaluate(() => (document.querySelector('#player') as any).destroy());

      // Real-time observation window past the SDK delay, proving the
      // (cancelled) requests never show up once it resolves.
      await new Promise((resolve) => setTimeout(resolve, SDK_DELAY_MS + 1000));

      expect(manifestRequests).toEqual([]);
      expect(segmentRequests).toEqual([]);
    });

    // Same race, triggered by removing the element from the DOM instead of
    // an explicit destroy() call (disconnectedCallback's own teardown path).
    test(`removing the element before the SDK finishes loading requests no manifest/segment (${engine})`, async ({ page }) => {
      test.setTimeout(60_000);
      await gotoPlayer(page);
      await delaySdkResponse(page, sdkUrl);
      const manifestRequests = await trackRequestUrls(page, manifestGlob);
      const segmentRequests = await trackRequestUrls(page, segmentGlob);

      await setSrc(page, manifest);
      await page.evaluate(() => document.querySelector('#player')!.remove());

      await new Promise((resolve) => setTimeout(resolve, SDK_DELAY_MS + 1000));

      expect(manifestRequests).toEqual([]);
      expect(segmentRequests).toEqual([]);
    });

    // A -> B -> C in quick succession, all before the SDK is ready (same
    // engine throughout, so PlayerFactory reuses the same player instance
    // and just calls load() again): only C should ever be requested once
    // the engine is finally instantiated. Distinguished via query string -
    // the static server resolves the file ignoring it (server/static-server.
    // mjs), so each variant still serves the real fixture.
    test(`rapid src swap (A -> B -> C) while the SDK is still loading only requests C (${engine})`, async ({ page }) => {
      test.setTimeout(60_000);
      await gotoPlayer(page);
      await delaySdkResponse(page, sdkUrl);
      const manifestRequests = await trackRequestUrls(page, manifestGlob);

      await setSrc(page, `${manifest}?v=a`);
      await setSrc(page, `${manifest}?v=b`);
      await setSrc(page, `${manifest}?v=c`);

      await expect.poll(() => manifestRequests.length, { timeout: SDK_DELAY_MS + 20_000 }).toBeGreaterThan(0);
      // Give any (incorrect) extra request a moment to show up too.
      await new Promise((resolve) => setTimeout(resolve, 500));

      expect(manifestRequests).toHaveLength(1);
      expect(manifestRequests[0]).toContain('v=c');
    });
  }
});
