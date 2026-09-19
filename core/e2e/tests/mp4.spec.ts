import { test, expect } from '../utils/hermetic';
import { gotoPlayer, instrument, setSrc, getLog, callMethod, getProp } from '../utils/media';

const FIXTURE = '/fixtures/mp4/sample.mp4';
const EXPECTED_DURATION = 4;

test.describe('mp4', () => {
  test('loads metadata, plays, pauses, seeks, and emits no error', async ({ page }) => {
    await gotoPlayer(page);
    await instrument(page);
    await setSrc(page, FIXTURE);

    await expect.poll(async () => (await getLog(page)).some((e) => e.name === 'loadedmetadata')).toBe(true);

    const duration = await getProp(page, 'duration');
    expect(duration).toBeCloseTo(EXPECTED_DURATION, 0);

    await callMethod(page, 'play');
    await expect.poll(async () => (await getProp(page, 'currentTime')) as number, { timeout: 10_000 }).toBeGreaterThan(1);

    const log = await getLog(page);
    const names = log.map((e) => e.name);
    expect(names.indexOf('play')).toBeGreaterThanOrEqual(0);
    expect(names.indexOf('playing')).toBeGreaterThan(names.indexOf('play'));
    expect(names.indexOf('timeupdate')).toBeGreaterThan(names.indexOf('playing'));
    expect(names).not.toContain('error');

    await callMethod(page, 'pause');
    await expect.poll(async () => getProp(page, 'paused')).toBe(true);

    await page.evaluate(() => {
      const el = document.querySelector('#player') as HTMLVideoElement;
      el.currentTime = 0.5;
    });
    await expect.poll(async () => (await getLog(page)).some((e) => e.name === 'seeked')).toBe(true);
    const currentTime = (await getProp(page, 'currentTime')) as number;
    expect(currentTime).toBeCloseTo(0.5, 1);

    expect((await getLog(page)).map((e) => e.name)).not.toContain('error');
  });
});
