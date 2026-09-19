import { test, expect } from '../utils/hermetic';
import {
  gotoPlayer,
  instrument,
  setSrc,
  getLog,
  callMethod,
  getProp,
  videoRenditions,
  audioTracks,
} from '../utils/media';
import fixtureManifest from '../fixtures/manifest.json' with { type: 'json' };

const FIXTURE = '/fixtures/hls/master.m3u8';

test.describe('hls', () => {
  test('loads metadata, plays, pauses, seeks, exposes renditions/audio, no error', async ({ page }) => {
    await gotoPlayer(page);
    await instrument(page);
    await setSrc(page, FIXTURE);

    await expect.poll(async () => (await getLog(page)).some((e) => e.name === 'loadedmetadata')).toBe(true);
    const duration = await getProp(page, 'duration');
    expect(duration).toBeCloseTo(fixtureManifest.duration, 0);

    await expect.poll(async () => (await videoRenditions(page)).length).toBe(fixtureManifest.hls.renditions.length);
    await expect.poll(async () => (await audioTracks(page)).length).toBe(fixtureManifest.hls.audioTracks);

    const renditions = (await videoRenditions(page)).sort((a, b) => b.width - a.width);
    const expected = [...fixtureManifest.hls.renditions].sort((a, b) => b.width - a.width);
    expect(renditions).toEqual(expected);

    await callMethod(page, 'play');
    await expect.poll(async () => (await getProp(page, 'currentTime')) as number, { timeout: 10_000 }).toBeGreaterThan(1);

    const names = (await getLog(page)).map((e) => e.name);
    expect(names.indexOf('play')).toBeGreaterThanOrEqual(0);
    expect(names.indexOf('playing')).toBeGreaterThan(names.indexOf('play'));
    expect(names.indexOf('timeupdate')).toBeGreaterThan(names.indexOf('playing'));
    expect(names).not.toContain('error');

    await callMethod(page, 'pause');
    await expect.poll(async () => getProp(page, 'paused')).toBe(true);

    await page.evaluate(() => {
      (document.querySelector('#player') as HTMLMediaElement).currentTime = 0.5;
    });
    await expect.poll(async () => (await getLog(page)).some((e) => e.name === 'seeked')).toBe(true);
    expect((await getProp(page, 'currentTime')) as number).toBeCloseTo(0.5, 1);

    expect((await getLog(page)).map((e) => e.name)).not.toContain('error');
  });
});
