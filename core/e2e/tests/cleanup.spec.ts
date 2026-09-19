import { test, expect } from '../utils/hermetic';
import { gotoPlayer, setSrc } from '../utils/media';

// Slows each segment response so a 4s VOD clip doesn't finish buffering
// before we can remove the element and observe whether requests stop.
const SEGMENT_DELAY_MS = 250;

const CASES = [
  { engine: 'hls', fixture: '/fixtures/hls/master.m3u8', segmentGlob: '**/fixtures/hls/**/*.m4s' },
  { engine: 'dash', fixture: '/fixtures/dash/manifest.mpd', segmentGlob: '**/fixtures/dash/**/*.m4s' },
];

async function trackSegmentRequests(page: import('@playwright/test').Page, segmentGlob: string) {
  const requests: number[] = [];
  await page.route(segmentGlob, async (route) => {
    requests.push(Date.now());
    await new Promise((r) => setTimeout(r, SEGMENT_DELAY_MS));
    await route.continue();
  });
  return requests;
}

test.describe('cleanup on removal', () => {
  for (const { engine, fixture, segmentGlob } of CASES) {
    // ultra-media-element.ts now overrides `disconnectedCallback` and calls
    // the public `destroy()` (deferred to a microtask - see result.md
    // "decisões de design"), which tears down the active hls.js/dash.js
    // instance. This proves segment requests actually stop once the element
    // leaves the DOM, for both engines.
    test(`removing the element from the DOM stops segment downloads (${engine})`, async ({ page }) => {
      await gotoPlayer(page);
      const requests = await trackSegmentRequests(page, segmentGlob);
      await setSrc(page, fixture);

      await expect.poll(() => requests.length, { timeout: 10_000 }).toBeGreaterThan(0);

      await page.evaluate(() => document.querySelector('#player')!.remove());
      const countAtRemoval = requests.length;

      // Proving a *negative* (no more requests) needs a fixed real-time
      // observation window, not an event to poll for - a plain timer, not
      // Playwright's built-in fixed-delay helper (reserved for state sync).
      await new Promise((resolve) => setTimeout(resolve, 2000));
      expect(requests.length).toBe(countAtRemoval);
    });
  }
});
