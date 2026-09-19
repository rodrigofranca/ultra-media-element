import { test, expect } from '../utils/hermetic';
import { gotoPlayer, instrument, setSrc, getLog } from '../utils/media';

const MISSING_MANIFEST = '/fixtures/hls/does-not-exist.m3u8';

test.describe('error handling', () => {
  test('a 404 manifest emits a structured `error` event and throws nothing unhandled', async ({ page }) => {
    await gotoPlayer(page);
    await instrument(page);
    await setSrc(page, MISSING_MANIFEST);

    await expect.poll(async () => (await getLog(page)).some((e) => e.name === 'error')).toBe(true);

    const errorEvent = (await getLog(page)).find((e) => e.name === 'error');
    expect(errorEvent?.detail).toMatchObject({
      fatal: true,
    });
    expect((errorEvent?.detail as { type?: string })?.type).toBeTruthy();
    // pageErrors fixture (hermetic.ts) asserts no unhandled exception on teardown.
  });
});
