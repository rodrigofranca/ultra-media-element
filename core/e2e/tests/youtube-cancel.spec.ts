import { test, expect } from '../utils/hermetic';
import { gotoPlayer, setSrc } from '../utils/media';
import { stubYouTubeIframeApi, getYouTubeCreated as getCreated, YOUTUBE_API_DELAY_MS as API_DELAY_MS } from '../utils/youtube-stub';

test.describe('youtube: cancel stale sources while the IFrame API is still loading', () => {
  // Three src changes (same format throughout, so UltraMediaElement reuses
  // the one YouTubePlayer instance and just calls load() again) before the
  // stubbed API resolves - before the fix, each load() chained its own
  // `.onReady.then(...)`, so all three survived and created a player each.
  test('rapid src swap (A -> B -> C) before the API is ready only creates a player for C', async ({ page }) => {
    test.setTimeout(60_000);
    await gotoPlayer(page);
    await stubYouTubeIframeApi(page);

    await setSrc(page, 'https://www.youtube.com/watch?v=AAAAAAAAAAA');
    await setSrc(page, 'https://www.youtube.com/watch?v=BBBBBBBBBBB');
    await setSrc(page, 'https://www.youtube.com/watch?v=CCCCCCCCCCC');

    await expect.poll(async () => (await getCreated(page)).length, { timeout: API_DELAY_MS + 20_000 }).toBeGreaterThan(0);
    // Give any (incorrect) extra creation a moment to show up too.
    await new Promise((resolve) => setTimeout(resolve, 500));

    expect(await getCreated(page)).toEqual(['CCCCCCCCCCC']);
  });

  // The public destroy() API, called before the stubbed IFrame API resolves,
  // must leave no player/iframe behind once it does.
  test('destroy() before the API is ready creates no player', async ({ page }) => {
    test.setTimeout(60_000);
    await gotoPlayer(page);
    await stubYouTubeIframeApi(page);

    await setSrc(page, 'https://www.youtube.com/watch?v=AAAAAAAAAAA');
    await page.evaluate(() => (document.querySelector('#player') as any).destroy());

    await new Promise((resolve) => setTimeout(resolve, API_DELAY_MS + 1000));

    expect(await getCreated(page)).toEqual([]);
    expect(await page.evaluate(() => document.querySelector('#player')?.shadowRoot?.querySelector('iframe') ?? null)).toBeNull();
  });

  // Same race, triggered by removing the element from the DOM (an *effective*
  // disconnect - the teardown microtask actually runs destroy()) instead of
  // an explicit destroy() call.
  test('removing the element before the API is ready creates no player', async ({ page }) => {
    test.setTimeout(60_000);
    await gotoPlayer(page);
    await stubYouTubeIframeApi(page);

    await setSrc(page, 'https://www.youtube.com/watch?v=AAAAAAAAAAA');
    await page.evaluate(() => document.querySelector('#player')!.remove());
    // Let disconnectedCallback's teardown microtask actually run.
    await new Promise((resolve) => setTimeout(resolve, 200));

    await new Promise((resolve) => setTimeout(resolve, API_DELAY_MS + 1000));

    expect(await getCreated(page)).toEqual([]);
  });
});

test.describe('youtube: iframe mounts in the shadow root, not the light DOM (cycle 2, defect 2)', () => {
  test('the iframe is a child of the shadow root, absent from el.children, and cleaned up by destroy()', async ({ page }) => {
    test.setTimeout(30_000);
    await gotoPlayer(page);
    await stubYouTubeIframeApi(page);

    await setSrc(page, 'https://www.youtube.com/watch?v=AAAAAAAAAAA');
    await expect.poll(async () => (await getCreated(page)).length, { timeout: 20_000 }).toBeGreaterThan(0);

    const placement = await page.evaluate(() => {
      const el = document.querySelector('#player')!;
      return {
        lightDomChildren: el.children.length,
        shadowIframeCount: el.shadowRoot?.querySelectorAll('iframe').length ?? 0,
      };
    });
    expect(placement).toEqual({ lightDomChildren: 0, shadowIframeCount: 1 });

    await page.evaluate(() => (document.querySelector('#player') as any).destroy());

    const afterDestroy = await page.evaluate(() => {
      const el = document.querySelector('#player')!;
      return {
        lightDomChildren: el.children.length,
        shadowIframeCount: el.shadowRoot?.querySelectorAll('iframe').length ?? 0,
      };
    });
    expect(afterDestroy).toEqual({ lightDomChildren: 0, shadowIframeCount: 0 });
  });
});
