import { test, expect } from '../utils/hermetic';
import { gotoPlayer, instrument, setSrc, getLog, resetLog, callMethod, getProp } from '../utils/media';

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

  // Descoberta: core/src/players/video-player.ts:35 and
  // core/src/players/audio-player.ts:15 tear down by doing
  // `this.element.src = ''`. Setting an empty string `src` on a native
  // <video>/<audio> is itself a valid (if unusual) source per the HTML spec,
  // which runs the "media element load algorithm" and fires a real `error`
  // (MEDIA_ERR_SRC_NOT_SUPPORTED-shaped) event on the element - forwarded
  // by super-media-element up to <ultra-media> as a native `error` event
  // (not the player's structured CustomEvent('error', {detail}); this one's
  // `detail` is null). A host listening for `error` to show a "playback
  // failed" UI sees a false positive on every hls/dash -> mp4/audio format
  // swap. `element.removeAttribute('src')` would not have this side effect.
  // Not fixed here (out of scope - no src/ changes).
  test('swapping away from mp4/audio does not fire a spurious native error event', async ({ page }) => {
    test.fail();
    await gotoPlayer(page);
    await instrument(page);

    await loadAndPlayThrough(page, SOURCES.mp4);
    await resetLog(page);
    await setSrc(page, SOURCES.dash);
    await expect.poll(async () => (await getLog(page)).some((e) => e.name === 'loadedmetadata'), { timeout: 10_000 }).toBe(true);

    expect((await getLog(page)).map((e) => e.name)).not.toContain('error');
  });
});
