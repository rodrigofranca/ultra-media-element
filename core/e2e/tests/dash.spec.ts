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

const FIXTURE = '/fixtures/dash/manifest.mpd';

test.describe('dash', () => {
  test('loads metadata, plays, pauses, seeks, exposes renditions/audio, no error', async ({ page }) => {
    await gotoPlayer(page);
    await instrument(page);
    await setSrc(page, FIXTURE);

    await expect.poll(async () => (await getLog(page)).some((e) => e.name === 'loadedmetadata')).toBe(true);
    const duration = await getProp(page, 'duration');
    expect(duration).toBeCloseTo(fixtureManifest.duration, 0);

    await expect.poll(async () => (await audioTracks(page)).length, { timeout: 10_000 }).toBe(fixtureManifest.dash.audioTracks);
    // One rendition per bitrate Representation (2, for this fixture's
    // single AdaptationSet) - see the dedicated spec below for the full
    // width/height/bitrate assertion and result.md "decisões de design".
    await expect.poll(async () => (await videoRenditions(page)).length).toBe(fixtureManifest.dash.videoRepresentationsInAdaptationSet);

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

  // core/src/players/dash-player.ts now builds `tracks.renditions` from
  // `player.getRepresentationsByType('video')`, which returns one
  // Representation per bitrate (with real width/height/bandwidth) instead
  // of one MediaInfo per AdaptationSet - see result.md "decisões de
  // design" for how that was confirmed against dash.js 5.2.1's actual
  // source (dist/modern/umd/dash.all.debug.js).
  test('exposes one videoRendition per bitrate Representation', async ({ page }) => {
    await gotoPlayer(page);
    await setSrc(page, FIXTURE);

    await expect.poll(async () => (await videoRenditions(page)).length).toBe(
      fixtureManifest.dash.videoRepresentationsInAdaptationSet
    );
    const renditions = (await videoRenditions(page)).sort((a, b) => b.width - a.width);
    expect(renditions).toEqual([
      { width: 480, height: 270 },
      { width: 320, height: 180 },
    ]);
  });
});
