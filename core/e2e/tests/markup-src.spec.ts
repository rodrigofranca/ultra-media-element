import { test, expect } from '../utils/hermetic';

// custom-media-element serializes every attribute of the host into its
// template, so a `src` present before the upgrade would land on the inner
// <video> as a raw manifest/YouTube URL - the browser would then start a
// native load in parallel with the engine (native HLS on Safari/TVs, an
// `error` on Chromium). The shell must keep `src` off the template.
test.describe('src present in markup before the element is defined', () => {
  test('the raw src never becomes the inner <video>\'s src attribute, and the engine still plays', async ({ page }) => {
    const nativeSrcsSeen: string[] = [];
    page.on('request', (req) => {
      if (req.resourceType() === 'media') nativeSrcsSeen.push(req.url());
    });

    await page.goto('/markup-src.html');
    await page.waitForFunction(() => customElements.get('ultra-media') !== undefined);

    const nativeSrcAttr = await page.evaluate(() => {
      const el = document.getElementById('player') as any;
      return el.nativeEl.getAttribute('src');
    });
    expect(nativeSrcAttr === null || nativeSrcAttr.startsWith('blob:')).toBe(true);

    await expect
      .poll(async () => page.evaluate(() => (document.getElementById('player') as any).nativeEl.readyState), { timeout: 10_000 })
      .toBeGreaterThanOrEqual(1);

    await page.evaluate(() => (document.getElementById('player') as any).play());
    await expect
      .poll(async () => page.evaluate(() => (document.getElementById('player') as any).currentTime), { timeout: 10_000 })
      .toBeGreaterThan(0.5);

    expect(nativeSrcsSeen.filter((u) => u.endsWith('master.m3u8'))).toEqual([]);
  });
});
