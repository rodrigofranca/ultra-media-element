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
    // Real rendition count/shape is asserted (and shown broken) in the
    // dedicated test.fail() spec below - see the Descoberta comment there.
    await expect.poll(async () => (await videoRenditions(page)).length).toBe(fixtureManifest.dash.videoAdaptationSets);

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

  // Descoberta: core/src/players/dash-player.ts:72-79 builds `tracks.renditions`
  // from `player.getTracksFor('video')`, which returns one MediaInfo per DASH
  // AdaptationSet - not one per bitrate Representation. A normal multi-bitrate
  // manifest (like this fixture: 1 AdaptationSet, 2 Representations at 480x270
  // and 320x180, see e2e/fixtures/dash/manifest.mpd) collapses to a single
  // rendition with width/height/bitrate all `undefined` (those fields live in
  // MediaInfo.bitrateList, which dash-player.ts never reads). hls-player.ts's
  // equivalent code (lines 54-61) reads hls.js's `data.levels`, which *is*
  // already a flat per-rendition list, so HLS doesn't have this gap - see
  // e2e/tests/hls.spec.ts, which asserts the same shape successfully.
  // Not fixed here (out of scope - no src/ changes). This test documents the
  // expected/correct behavior and is left failing on purpose.
  test('exposes one videoRendition per bitrate Representation', async ({ page }) => {
    test.fail();
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
