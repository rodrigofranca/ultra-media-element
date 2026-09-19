import { test, expect } from '../utils/hermetic';
import { gotoPlayer, setSrc } from '../utils/media';

const FIXTURE = '/fixtures/hls/master.m3u8';
// Slows each segment response so a 4s VOD clip doesn't finish buffering
// before we can remove the element and observe whether requests stop.
const SEGMENT_DELAY_MS = 250;

async function trackSegmentRequests(page: import('@playwright/test').Page) {
  const requests: number[] = [];
  await page.route('**/fixtures/hls/**/*.m4s', async (route) => {
    requests.push(Date.now());
    await new Promise((r) => setTimeout(r, SEGMENT_DELAY_MS));
    await route.continue();
  });
  return requests;
}

test.describe('cleanup on removal', () => {
  // Descoberta: core/src/ultra-media-element.ts never overrides
  // `disconnectedCallback` to call the (private) `destroyPlayer()` - see
  // lines 43-45 (only `connectedCallback` is defined) and 151-157
  // (`destroyPlayer` is only ever called from `attributeChangedCallback`,
  // on a `src` format change). `SuperVideoElement`'s own
  // `disconnectedCallback` (node_modules/super-media-element) is also a
  // no-op. There is no public `destroy()` on <ultra-media> either.
  // Net effect: removing the element from the DOM does not stop hls.js
  // (or dash.js) from continuing to fetch segments - this test proves it
  // by delaying segment responses and checking requests keep arriving after
  // `.remove()`. Not fixed here (out of scope - no src/ changes).
  test('removing the element from the DOM stops segment downloads', async ({ page }) => {
    test.fail();
    await gotoPlayer(page);
    const requests = await trackSegmentRequests(page);
    await setSrc(page, FIXTURE);

    await expect.poll(() => requests.length, { timeout: 10_000 }).toBeGreaterThan(0);

    await page.evaluate(() => document.querySelector('#player')!.remove());
    const countAtRemoval = requests.length;

    // Proving a *negative* (no more requests) needs a fixed real-time
    // observation window, not an event to poll for - a plain timer, not
    // Playwright's built-in fixed-delay helper (reserved for state sync).
    await new Promise((resolve) => setTimeout(resolve, 2000));
    expect(requests.length).toBe(countAtRemoval);
  });
});
