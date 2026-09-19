import { test, expect } from '../utils/hermetic';

test.describe('entry point isolation', () => {
  test('the core entry does not register <ultra-media-ad>', async ({ page }) => {
    await page.goto('/player.html');
    await page.waitForFunction(() => customElements.get('ultra-media') !== undefined);

    const adDefined = await page.evaluate(() => customElements.get('ultra-media-ad') !== undefined);
    expect(adDefined).toBe(false);
  });

  test('the /ad entry registers <ultra-media-ad>', async ({ page }) => {
    await page.goto('/ad-entry.html');
    await page.waitForFunction(() => customElements.get('ultra-media-ad') !== undefined);

    const adDefined = await page.evaluate(() => customElements.get('ultra-media-ad') !== undefined);
    expect(adDefined).toBe(true);

    // The /ad entry only imports its own element - it never pulls in the
    // core registration path, so <ultra-media> must stay undefined here too.
    const coreDefined = await page.evaluate(() => customElements.get('ultra-media') !== undefined);
    expect(coreDefined).toBe(false);
  });
});
