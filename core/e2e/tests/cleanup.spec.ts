import { test, expect } from '../utils/hermetic';
import { gotoPlayer, setSrc, instrument, getLog, resetLog, callMethod, getProp, videoRenditions } from '../utils/media';

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

    // Same proof as above, but for the *public* destroy() API directly
    // (no DOM removal involved) - the element stays connected, only the
    // underlying engine is torn down.
    test(`calling the public destroy() stops segment downloads (${engine})`, async ({ page }) => {
      await gotoPlayer(page);
      const requests = await trackSegmentRequests(page, segmentGlob);
      await setSrc(page, fixture);

      await expect.poll(() => requests.length, { timeout: 10_000 }).toBeGreaterThan(0);

      await page.evaluate(() => (document.querySelector('#player') as any).destroy());
      const countAtDestroy = requests.length;

      await new Promise((resolve) => setTimeout(resolve, 2000));
      expect(requests.length).toBe(countAtDestroy);
    });
  }

  // Reconnecting after an *effective* teardown (the disconnectedCallback
  // microtask actually ran destroy() - i.e. the element was gone long
  // enough, not just synchronously moved) must resume playback on its own,
  // with no further action needed from the host page - connectedCallback
  // re-initializes from the unchanged `src` (see ultra-media-element.ts).
  for (const { engine, fixture } of CASES) {
    test(`reconnecting after an effective teardown resumes playback (${engine})`, async ({ page }) => {
      await gotoPlayer(page);
      await instrument(page);
      await setSrc(page, fixture);

      await expect.poll(async () => (await getLog(page)).some((e) => e.name === 'loadedmetadata'), { timeout: 10_000 }).toBe(true);
      await callMethod(page, 'play');
      await expect.poll(async () => (await getProp(page, 'currentTime')) as number, { timeout: 10_000 }).toBeGreaterThan(0.3);

      const el = await page.evaluateHandle(() => document.querySelector('#player')!);
      await page.evaluate((node) => node.remove(), el);
      // Let disconnectedCallback's teardown microtask actually run before
      // reconnecting - long enough that this is a real disconnect, not the
      // synchronous move case source-swap.spec.ts/cleanup's own debounce
      // test already covers.
      await new Promise((resolve) => setTimeout(resolve, 200));

      await resetLog(page);
      await page.evaluate((node) => document.body.appendChild(node), el);

      await expect.poll(async () => (await getLog(page)).some((e) => e.name === 'loadedmetadata'), { timeout: 10_000 }).toBe(true);
      await callMethod(page, 'play');
      await expect.poll(async () => (await getProp(page, 'currentTime')) as number, { timeout: 10_000 }).toBeGreaterThan(0.3);
      expect((await getLog(page)).some((e) => e.name === 'error')).toBe(false);
    });
  }

  // Moving the element to a different parent (disconnect immediately
  // followed by a synchronous reconnect elsewhere - the microtask never
  // gets a chance to see it as disconnected, see ultra-media-element.ts's
  // disconnectedCallback comment) must not interrupt playback at all: no
  // teardown, so no new manifest request and currentTime keeps advancing
  // through the move.
  for (const { engine, fixture } of CASES) {
    test(`moving the element in the DOM during playback does not interrupt it (${engine})`, async ({ page }) => {
      await gotoPlayer(page);
      await instrument(page);
      const manifestGlob = engine === 'hls' ? '**/fixtures/hls/master.m3u8*' : '**/fixtures/dash/manifest.mpd*';
      const manifestRequests: string[] = [];
      await page.route(manifestGlob, async (route) => {
        manifestRequests.push(route.request().url());
        await route.continue();
      });

      await setSrc(page, fixture);
      await expect.poll(async () => (await getLog(page)).some((e) => e.name === 'loadedmetadata'), { timeout: 10_000 }).toBe(true);
      await callMethod(page, 'play');
      await expect.poll(async () => (await getProp(page, 'currentTime')) as number, { timeout: 10_000 }).toBeGreaterThan(0.3);

      const countBeforeMove = manifestRequests.length;
      const timeBeforeMove = (await getProp(page, 'currentTime')) as number;

      await page.evaluate(() => {
        const el = document.querySelector('#player')!;
        const wrapper = document.createElement('div');
        document.body.appendChild(wrapper);
        wrapper.appendChild(el); // disconnect + reconnect, same tick
      });

      await expect.poll(async () => (await getProp(page, 'currentTime')) as number, { timeout: 10_000 }).toBeGreaterThan(timeBeforeMove);
      expect(manifestRequests.length).toBe(countBeforeMove);
      expect((await getLog(page)).some((e) => e.name === 'error')).toBe(false);
    });
  }
});

test.describe('removeAttribute("src") tears playback down (cycle 2, defect 1)', () => {
  for (const { engine, fixture, segmentGlob } of CASES) {
    test(`removeAttribute("src") stops segment downloads, resets the <video>, clears renditions, and a new src resumes playback (${engine})`, async ({ page }) => {
      await gotoPlayer(page);
      await instrument(page);
      const requests = await trackSegmentRequests(page, segmentGlob);
      await setSrc(page, fixture);

      await expect.poll(() => requests.length, { timeout: 10_000 }).toBeGreaterThan(0);
      await expect.poll(async () => (await videoRenditions(page)).length, { timeout: 10_000 }).toBeGreaterThan(0);

      await page.evaluate(() => document.querySelector('#player')!.removeAttribute('src'));
      const countAtRemoval = requests.length;

      // Proving a *negative* (no more requests) needs a fixed real-time
      // observation window, not an event to poll for - see cleanup.spec.ts
      // above for the same pattern.
      await new Promise((resolve) => setTimeout(resolve, 2000));
      expect(requests.length).toBe(countAtRemoval);

      // Descoberta (result-cycle2.md): `nativeEl.currentSrc` is sticky in
      // Chromium - `removeAttribute('src') + load()` (what every engine's
      // teardown does, including native VideoPlayer/AudioPlayer) resets
      // networkState/readyState to empty/nothing (verified independently of
      // this codebase, on a bare <video>) but does NOT clear `currentSrc`
      // back to '' - only selecting a *new* source does. networkState/
      // readyState are the real, reliably-observable "no source" signal.
      expect(await getProp(page, 'networkState')).toBe(0); // NETWORK_EMPTY
      expect(await getProp(page, 'readyState')).toBe(0); // HAVE_NOTHING
      expect(await videoRenditions(page)).toEqual([]);

      await resetLog(page);
      await setSrc(page, fixture);
      await expect.poll(async () => (await getLog(page)).some((e) => e.name === 'loadedmetadata'), { timeout: 10_000 }).toBe(true);
      await callMethod(page, 'play');
      await expect.poll(async () => (await getProp(page, 'currentTime')) as number, { timeout: 10_000 }).toBeGreaterThan(0.3);
      expect((await getLog(page)).some((e) => e.name === 'error')).toBe(false);
    });
  }
});

test.describe('reload after destroy() (defect 5)', () => {
  for (const { engine, fixture } of CASES) {
    // el.destroy(); el.src = el.src (same value) must reload - see
    // ultra-media-element.ts's attributeChangedCallback comment.
    test(`destroy() then reassigning the same src resumes playback (${engine})`, async ({ page }) => {
      await gotoPlayer(page);
      await instrument(page);
      await setSrc(page, fixture);

      await expect.poll(async () => (await getLog(page)).some((e) => e.name === 'loadedmetadata'), { timeout: 10_000 }).toBe(true);

      await page.evaluate(() => (document.querySelector('#player') as any).destroy());
      await resetLog(page);

      await page.evaluate((src) => {
        const el = document.querySelector('#player') as HTMLMediaElement;
        el.setAttribute('src', src);
      }, fixture);

      await expect.poll(async () => (await getLog(page)).some((e) => e.name === 'loadedmetadata'), { timeout: 10_000 }).toBe(true);
      await callMethod(page, 'play');
      await expect.poll(async () => (await getProp(page, 'currentTime')) as number, { timeout: 10_000 }).toBeGreaterThan(0.3);
      expect((await getLog(page)).some((e) => e.name === 'error')).toBe(false);
    });
  }
});
