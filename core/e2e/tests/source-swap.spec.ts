import { test, expect } from '../utils/hermetic';
import { gotoPlayer, instrument, setSrc, getLog, resetLog, callMethod, getProp, videoRenditions } from '../utils/media';

const SOURCES = {
  hls: '/fixtures/hls/master.m3u8',
  mp4: '/fixtures/mp4/sample.mp4',
  dash: '/fixtures/dash/manifest.mpd',
};

async function loadAndPlayThrough(page: import('@playwright/test').Page, src: string) {
  await resetLog(page);
  await setSrc(page, src);
  await expect.poll(async () => (await getLog(page)).some((e) => e.name === 'loadedmetadata'), { timeout: 10_000 }).toBe(true);
  await callMethod(page, 'play');
  await expect.poll(async () => (await getProp(page, 'currentTime')) as number, { timeout: 10_000 }).toBeGreaterThan(0.5);
  await callMethod(page, 'pause');
}

test.describe('source swap', () => {
  test('switches hls -> mp4 -> dash on the same element and plays each', async ({ page }) => {
    await gotoPlayer(page);
    await instrument(page);

    await loadAndPlayThrough(page, SOURCES.hls);
    await loadAndPlayThrough(page, SOURCES.mp4);
    await loadAndPlayThrough(page, SOURCES.dash);
  });

  // core/src/players/video-player.ts and audio-player.ts now tear down with
  // `removeAttribute('src')` + `load()` instead of `element.src = ''` - the
  // latter is itself a valid (if unusual) source per the HTML spec and runs
  // the "media element load algorithm", firing a real `error` event; the
  // former lets that same algorithm see there's nothing to load and reset
  // to NETWORK_EMPTY silently. See result.md "decisões de design".
  test('swapping away from mp4/audio does not fire a spurious native error event', async ({ page }) => {
    await gotoPlayer(page);
    await instrument(page);

    await loadAndPlayThrough(page, SOURCES.mp4);
    await resetLog(page);
    await setSrc(page, SOURCES.dash);
    await expect.poll(async () => (await getLog(page)).some((e) => e.name === 'loadedmetadata'), { timeout: 10_000 }).toBe(true);

    expect((await getLog(page)).map((e) => e.name)).not.toContain('error');
  });

  // cycle 2, defect 3: the native mp4 player never calls onTracksChange, so
  // the hls renditions used to stay visible on `videoRenditions` forever
  // after switching away from hls - UltraMediaCore.teardownPlayer() must
  // clear them itself (see ultra-media-core.test.ts for the unit-level
  // proof against a fake player).
  test('switching hls -> mp4 clears the stale hls renditions', async ({ page }) => {
    await gotoPlayer(page);

    await setSrc(page, SOURCES.hls);
    await expect.poll(async () => (await videoRenditions(page)).length, { timeout: 10_000 }).toBeGreaterThan(0);

    await setSrc(page, SOURCES.mp4);
    await expect.poll(async () => (await getProp(page, 'readyState')) as number, { timeout: 10_000 }).toBeGreaterThan(0);

    expect(await videoRenditions(page)).toEqual([]);
  });
});
