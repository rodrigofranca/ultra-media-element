import { test, expect } from '../utils/hermetic';
import { gotoPlayer, instrument, setSrc, getLog, resetLog, callMethod, getProp } from '../utils/media';

// Distinct query strings on the same underlying fixture - the static server
// ignores them (see server/static-server.mjs), but they still show up as
// distinct request URLs and distinct `nativeEl.currentSrc` values, which is
// what these tests need to prove B (not A) actually loaded.
const MP4_A = '/fixtures/mp4/sample.mp4?v=a';
const MP4_B = '/fixtures/mp4/sample.mp4?v=b';
const HLS_A = '/fixtures/hls/master.m3u8';

/**
 * Performs a disconnect + src change + reconnect all inside one
 * page.evaluate() call, so it's genuinely synchronous from the browser's
 * point of view - the teardown microtask ultra-media-element.ts's
 * disconnectedCallback schedules never gets a chance to see the element as
 * disconnected (same move pattern as cleanup.spec.ts's "moving the element
 * in the DOM during playback" test, plus a src change in the middle).
 */
async function moveAndChangeSrc(page: import('@playwright/test').Page, newSrc: string): Promise<void> {
  await page.evaluate((src) => {
    const el = document.querySelector('#player')!;
    const wrapper = document.createElement('div');
    document.body.appendChild(wrapper);
    el.remove();
    el.setAttribute('src', src);
    wrapper.appendChild(el);
  }, newSrc);
}

test.describe('src change during a synchronous DOM move (cycle 3, defect 2)', () => {
  // Same format (mp4 -> mp4): UltraMediaElement reuses VideoPlayer and calls
  // load() directly - before the fix, attributeChangedCallback saw
  // `!isConnected` mid-move and bailed, and connectedCallback only acted
  // when `!this.player` (it still existed), so the `src` attribute became B
  // but `nativeEl.src`/`currentSrc` stayed on A.
  test('resumes with the new src after a same-format change made during the move (mp4 -> mp4)', async ({ page }) => {
    await gotoPlayer(page);
    await instrument(page);
    const requests: string[] = [];
    await page.route('**/fixtures/mp4/sample.mp4*', async (route) => {
      requests.push(route.request().url());
      await route.continue();
    });

    await setSrc(page, MP4_A);
    await expect.poll(async () => (await getLog(page)).some((e) => e.name === 'loadedmetadata'), { timeout: 10_000 }).toBe(true);
    await callMethod(page, 'play');
    await expect.poll(async () => (await getProp(page, 'currentTime')) as number, { timeout: 10_000 }).toBeGreaterThan(0.3);
    expect(requests.some((u) => u.includes('v=a'))).toBe(true);

    await resetLog(page);
    await moveAndChangeSrc(page, MP4_B);

    await expect.poll(async () => requests.some((u) => u.includes('v=b')), { timeout: 10_000 }).toBe(true);
    await expect.poll(async () => (await getProp(page, 'currentSrc')) as string, { timeout: 10_000 }).toContain('v=b');

    await expect.poll(async () => (await getLog(page)).some((e) => e.name === 'loadedmetadata'), { timeout: 10_000 }).toBe(true);
    await callMethod(page, 'play');
    await expect.poll(async () => (await getProp(page, 'currentTime')) as number, { timeout: 10_000 }).toBeGreaterThan(0.3);
    expect((await getLog(page)).some((e) => e.name === 'error')).toBe(false);
  });

  // Format change (hls -> mp4) during the same synchronous move: the old
  // engine must be torn down and the new one created for B, not left
  // pointed at the now-stale A.
  test('resumes with the new src after a format-changing change made during the move (hls -> mp4)', async ({ page }) => {
    await gotoPlayer(page);
    await instrument(page);

    await setSrc(page, HLS_A);
    await expect.poll(async () => (await getLog(page)).some((e) => e.name === 'loadedmetadata'), { timeout: 10_000 }).toBe(true);
    await callMethod(page, 'play');
    await expect.poll(async () => (await getProp(page, 'currentTime')) as number, { timeout: 10_000 }).toBeGreaterThan(0.3);

    await resetLog(page);
    await moveAndChangeSrc(page, MP4_B);

    await expect.poll(async () => (await getProp(page, 'currentSrc')) as string, { timeout: 10_000 }).toContain('v=b');
    await expect.poll(async () => (await getLog(page)).some((e) => e.name === 'loadedmetadata'), { timeout: 10_000 }).toBe(true);
    await callMethod(page, 'play');
    await expect.poll(async () => (await getProp(page, 'currentTime')) as number, { timeout: 10_000 }).toBeGreaterThan(0.3);
    expect((await getLog(page)).some((e) => e.name === 'error')).toBe(false);
  });

  // Control case: moving without changing `src` must stay a pure no-op -
  // no reload, no new request - matching cleanup.spec.ts's existing
  // "moving the element in the DOM during playback" coverage, repeated here
  // against the same fixed reference point (loadedSrc) the fix introduces.
  test('does not reload when src is unchanged across the same move', async ({ page }) => {
    await gotoPlayer(page);
    await instrument(page);
    const requests: string[] = [];
    await page.route('**/fixtures/mp4/sample.mp4*', async (route) => {
      requests.push(route.request().url());
      await route.continue();
    });

    await setSrc(page, MP4_A);
    await expect.poll(async () => (await getLog(page)).some((e) => e.name === 'loadedmetadata'), { timeout: 10_000 }).toBe(true);
    await callMethod(page, 'play');
    await expect.poll(async () => (await getProp(page, 'currentTime')) as number, { timeout: 10_000 }).toBeGreaterThan(0.3);

    const requestCountBeforeMove = requests.length;
    const timeBeforeMove = (await getProp(page, 'currentTime')) as number;

    await page.evaluate(() => {
      const el = document.querySelector('#player')!;
      const wrapper = document.createElement('div');
      document.body.appendChild(wrapper);
      wrapper.appendChild(el); // disconnect + reconnect, same tick - no src change
    });

    await expect.poll(async () => (await getProp(page, 'currentTime')) as number, { timeout: 10_000 }).toBeGreaterThan(timeBeforeMove);
    expect(requests.length).toBe(requestCountBeforeMove);
    expect((await getLog(page)).some((e) => e.name === 'error')).toBe(false);
  });
});
