import { test, expect } from '../utils/hermetic';
import {
  gotoPlayer,
  instrument,
  setSrc,
  getLog,
  resetLog,
  callMethod,
  getProp,
  videoRenditions,
  throttleCpu,
  getNativeState,
} from '../utils/media';

const SOURCES = {
  hls: '/fixtures/hls/master.m3u8',
  mp4: '/fixtures/mp4/sample.mp4',
  dash: '/fixtures/dash/manifest.mpd',
};

async function loadAndPlayThrough(page: import('@playwright/test').Page, src: string) {
  await resetLog(page);
  await setSrc(page, src);
  try {
    await expect.poll(async () => (await getLog(page)).some((e) => e.name === 'loadedmetadata'), { timeout: 10_000 }).toBe(true);
  } catch (err) {
    // Diagnostic dump for result-cycle3.md's required failure timeline - the
    // event log already carries a timestamp + src/currentSrc/networkState/
    // readyState per entry (see media.ts instrument()); this adds the state
    // at the exact moment the poll gave up, which no single log entry can.
    const log = await getLog(page);
    const state = await getNativeState(page);
    console.error(`loadAndPlayThrough(${src}) timed out waiting for loadedmetadata.\nlog: ${JSON.stringify(log)}\nstate at giveup: ${JSON.stringify(state)}`);
    throw err;
  }
  await callMethod(page, 'play');
  await expect.poll(async () => (await getProp(page, 'currentTime')) as number, { timeout: 10_000 }).toBeGreaterThan(0.5);
  await callMethod(page, 'pause');
}

/**
 * Proves only that the reload itself was not clobbered by the outgoing
 * engine's teardown - the exact mechanism result-cycle3.md's hypothesis was
 * about. Deliberately does *not* call play()/require currentTime progress:
 * under a forced CPU-throttled window (see throttleCpu below), requiring
 * real-time decode progress conflates two different concerns - a slow CPU
 * makes decode itself slow (a separate, already-known fragility, see
 * result-cycle2.md "Descobertas") and would fail this test for a reason
 * that has nothing to do with the teardown/reload race under test here
 * (confirmed: see result-cycle3.md's "Descobertas" for the one run where
 * requiring play() progress under 10x throttling did exactly that).
 */
async function swapAndConfirmReload(page: import('@playwright/test').Page, src: string) {
  await resetLog(page);
  await setSrc(page, src);
  try {
    await expect.poll(async () => (await getLog(page)).some((e) => e.name === 'loadedmetadata'), { timeout: 10_000 }).toBe(true);
  } catch (err) {
    const log = await getLog(page);
    const state = await getNativeState(page);
    console.error(`swapAndConfirmReload(${src}) timed out waiting for loadedmetadata.\nlog: ${JSON.stringify(log)}\nstate at giveup: ${JSON.stringify(state)}`);
    throw err;
  }
  // Not clobbered mid-race by the outgoing engine's async teardown tail: if
  // some deferred part of the *previous* engine's cleanup (a `sourceclose`
  // handler, a revoked object URL, a second `removeAttribute('src')`/
  // `load()`) landed late, it would reset the element and re-fire
  // `emptied`/`abort` *after* this `loadedmetadata` already recorded a good
  // load - readyState alone can't catch that (a later `emptied` also drops
  // it back to HAVE_NOTHING only briefly), but the ordered log can. currentSrc
  // isn't a useful check here: hls.js/dash.js set it to a MediaSource object
  // URL, not the manifest path, so it never equals `src` even on success.
  const log = await getLog(page);
  const metadataIndex = log.findIndex((e) => e.name === 'loadedmetadata');
  const clobberedAfter = log.slice(metadataIndex + 1).filter((e) => e.name === 'emptied' || e.name === 'abort');
  expect(clobberedAfter, `outgoing engine's teardown clobbered the reload after loadedmetadata: ${JSON.stringify(log)}`).toEqual([]);
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

// cycle 3: proves/guards against the hypothesized teardown-vs-reload race
// (result-cycle3.md's diagnosis) - UltraMediaCore.teardownPlayer() destroys
// the outgoing engine synchronously, then PlayerFactory.create() assigns the
// new src, still synchronously, in the same load() call. The concern was
// that part of the outgoing engine's cleanup (hls.js's BufferController
// MediaSource detach, dash.js's VideoModel.setSource(null) -
// removeAttribute('src')/load()) could land *after* that point and clobber
// the new src. 10x CPU throttling via CDP forces that window open
// deterministically - unlike relying on the host happening to be under
// load, which this cycle found does not reproduce this specific failure
// (see result-cycle3.md) - so this stays a real, repeatable regression
// guard instead of a one-off reproduction.
test.describe('source swap under a forced CPU-throttled teardown/reload window (cycle 3)', () => {
  const PAIRS: Array<[keyof typeof SOURCES, keyof typeof SOURCES]> = [
    ['hls', 'mp4'],
    ['mp4', 'hls'],
    ['mp4', 'dash'],
    ['dash', 'mp4'],
    ['hls', 'dash'],
    ['dash', 'hls'],
  ];

  for (const [from, to] of PAIRS) {
    test(`${from} -> ${to} reloads within the normal timeout under 10x CPU throttling`, async ({ page }) => {
      test.setTimeout(60_000);
      await gotoPlayer(page);
      await instrument(page);
      await throttleCpu(page, 10);

      await swapAndConfirmReload(page, SOURCES[from]);
      await swapAndConfirmReload(page, SOURCES[to]);
    });
  }
});
