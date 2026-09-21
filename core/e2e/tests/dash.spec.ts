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

// The DASH play() guard (players/play-guard.ts) arms for every DASH load,
// because live-ness is only known once the manifest arrives. It must be
// invisible for VOD: a host that calls play() in the same tick as the src
// assignment (autoplay-style) still gets playback, and a settled promise.
test.describe('dash VOD with an immediate play()', () => {
  test('play() in the same tick as src plays and its promise settles', async ({ page }) => {
    await gotoPlayer(page);
    const outcome = await page.evaluate(async (src) => {
      const el = document.getElementById('player') as any;
      el.muted = true;
      el.src = src;
      return el.play().then(() => 'resolved', (e: Error) => e.name);
    }, FIXTURE);
    expect(outcome).toBe('resolved');
    await expect.poll(async () => (await getProp(page, 'currentTime')) as number, { timeout: 10_000 }).toBeGreaterThan(0.5);
    const hasOwnPlay = await page.evaluate(() =>
      Object.prototype.hasOwnProperty.call((document.getElementById('player') as any).nativeEl, 'play'));
    expect(hasOwnPlay).toBe(false); // guard gone once the stream initialized
  });
});
