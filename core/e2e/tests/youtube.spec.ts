import { test, expect } from '@playwright/test';
import { gotoPlayer, instrument, setSrc, getLog, getProp, callMethod } from '../utils/media';

// Real network test: loads the actual YouTube IFrame API and a real video.
// Excluded from `pnpm e2e` (the CI-blocking hermetic suite) - only runs via
// `pnpm e2e:network`. Well-known, long-lived, publicly embeddable video.
const YOUTUBE_URL = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';

test.describe('youtube @network', () => {
  test('loads the IFrame API, plays, and currentTime advances', async ({ page }) => {
    await gotoPlayer(page);
    await instrument(page);
    await setSrc(page, YOUTUBE_URL);

    // playerVars.autoplay=1 alone doesn't reliably start playback headless;
    // an explicit play() call (what a real consumer would do) does.
    await expect.poll(async () => (await getProp(page, 'duration')) as number, { timeout: 20_000 }).toBeGreaterThan(0);
    await callMethod(page, 'play');

    await expect
      .poll(async () => (await getProp(page, 'currentTime')) as number, { timeout: 20_000 })
      .toBeGreaterThan(1);

    const duration = (await getProp(page, 'duration')) as number;
    expect(duration).toBeGreaterThan(0);
    expect((await getLog(page)).map((e) => e.name)).not.toContain('error');
  });
});
