import { test, expect } from '../utils/hermetic';
import { gotoPlayer, instrument, setSrc, getLog, callMethod, getProp } from '../utils/media';

const MISSING_HLS_MANIFEST = '/fixtures/hls/does-not-exist.m3u8';
const MISSING_DASH_MANIFEST = '/fixtures/dash/does-not-exist.mpd';
const MISSING_MP4 = '/fixtures/mp4/does-not-exist.mp4';
const HLS_FIXTURE = '/fixtures/hls/master.m3u8';

test.describe('error handling', () => {
  // (a) A manifest 404 is unrecoverable - hls.js/dash.js both retry a few
  // times (see result.md "decisões de design" for the exact policy read
  // out of each SDK's source) and then report it as fatal. Exactly one
  // `error` should reach the element, carrying the real HTTP status.
  for (const { engine, fixture } of [
    { engine: 'hls', fixture: MISSING_HLS_MANIFEST },
    { engine: 'dash', fixture: MISSING_DASH_MANIFEST },
  ]) {
    test(`(a) a 404 manifest emits exactly one fatal error with status 404 (${engine})`, async ({ page }) => {
      await gotoPlayer(page);
      await instrument(page);
      await setSrc(page, fixture);

      await expect.poll(async () => (await getLog(page)).some((e) => e.name === 'error'), { timeout: 15_000 }).toBe(true);

      // Give the engine a moment in case it were to (incorrectly) keep
      // firing more errors after the first one.
      await new Promise((resolve) => setTimeout(resolve, 500));

      const log = await getLog(page);
      const errorEvents = log.filter((e) => e.name === 'error');
      expect(errorEvents).toHaveLength(1);
      expect(log.some((e) => e.name === 'warning')).toBe(false);

      const detail = errorEvents[0].detail as Record<string, unknown>;
      expect(detail).toMatchObject({ fatal: true, status: 404 });
      expect(detail.category).toBeTruthy();
      expect(detail.code).toBeTruthy();
      expect(detail.message).toBeTruthy();
      expect(detail.engine).toBeTruthy();
    });
  }

  // (b) A single transient segment failure (500 once, success on retry) is
  // recoverable: hls.js's own errorRetry policy (fragLoadPolicy, default
  // maxNumRetry: 6, 1s delay - read out of node_modules/hls.js's debug
  // bundle) reloads the segment and playback continues. It still reports
  // the failed attempt through Hls.Events.ERROR with fatal:false - that
  // must reach the element as `warning`, never `error`.
  test('(b) a segment failing once then succeeding emits warning, no error, and playback continues (hls)', async ({ page }) => {
    await gotoPlayer(page);
    await instrument(page);

    let failedOnce = false;
    await page.route('**/fixtures/hls/**/out_high1.m4s', async (route) => {
      if (!failedOnce) {
        failedOnce = true;
        await route.fulfill({ status: 500, contentType: 'text/plain', body: 'Internal Server Error' });
        return;
      }
      await route.continue();
    });

    await setSrc(page, HLS_FIXTURE);
    await expect.poll(async () => (await getLog(page)).some((e) => e.name === 'loadedmetadata'), { timeout: 10_000 }).toBe(true);

    await expect.poll(async () => (await getLog(page)).some((e) => e.name === 'warning'), { timeout: 15_000 }).toBe(true);
    expect((await getLog(page)).some((e) => e.name === 'error')).toBe(false);

    const warningEvent = (await getLog(page)).find((e) => e.name === 'warning');
    const detail = warningEvent?.detail as Record<string, unknown>;
    expect(detail).toMatchObject({ fatal: false });
    expect(detail.engine).toBe('hls.js');

    // out_high1.m4s covers roughly t=[1,2) in this 4s fixture - playing
    // past t=2.5 proves the retry succeeded and playback moved past the
    // segment that failed once.
    await callMethod(page, 'play');
    await expect.poll(async () => (await getProp(page, 'currentTime')) as number, { timeout: 15_000 }).toBeGreaterThan(2.5);
    expect((await getLog(page)).some((e) => e.name === 'error')).toBe(false);
  });

  // (c) Native players (mp4/mp3) now participate in the same taxonomy - a
  // 404 on the underlying file is fatal and carries the same detail shape
  // as the HLS/DASH case, minus `status` (browsers don't expose the HTTP
  // status of a failed media load to script - see result.md "decisões de
  // design").
  test('(c) a 404 mp4 emits an error with the same detail shape', async ({ page }) => {
    await gotoPlayer(page);
    await instrument(page);
    await setSrc(page, MISSING_MP4);

    await expect.poll(async () => (await getLog(page)).some((e) => e.name === 'error'), { timeout: 10_000 }).toBe(true);

    const errorEvent = (await getLog(page)).find((e) => e.name === 'error');
    const detail = errorEvent?.detail as Record<string, unknown>;
    expect(detail).toMatchObject({ fatal: true, engine: 'video/mp4' });
    expect(detail.category).toBeTruthy();
    expect(detail.code).toBeTruthy();
    expect(detail.message).toBeTruthy();
    // pageErrors fixture (hermetic.ts) asserts no unhandled exception on teardown.
  });

  // (d) A DASH media segment that fails on *every* request (not just once,
  // unlike (b)'s HLS case) is unrecoverable: dash.js's HTTPLoader only
  // raises DOWNLOAD_ERROR_ID_CONTENT/INITIALIZATION_CODE once its own
  // internal retry budget for that resource (default: 3 retries, 1s apart -
  // mediaPlayerModel's retryAttempts/retryIntervals, read out of
  // dash.all.debug.js) is exhausted - by then playback is genuinely stuck,
  // so this must reach the element as `error`, fatal:true (see dash-player.
  // ts's isDashErrorRecoverable comment). expect.poll's timeout below
  // accounts for that ~3s retry window plus request overhead.
  test('(d) a DASH media segment failing on every request emits a fatal error', async ({ page }) => {
    await gotoPlayer(page);
    await instrument(page);

    await page.route('**/fixtures/dash/chunk-*.m4s', async (route) => {
      await route.fulfill({ status: 500, contentType: 'text/plain', body: 'Internal Server Error' });
    });

    await setSrc(page, '/fixtures/dash/manifest.mpd');

    await expect.poll(async () => (await getLog(page)).some((e) => e.name === 'error'), { timeout: 15_000 }).toBe(true);

    const errorEvent = (await getLog(page)).find((e) => e.name === 'error');
    const detail = errorEvent?.detail as Record<string, unknown>;
    expect(detail).toMatchObject({ fatal: true, engine: 'dash.js' });
    expect(detail.category).toBeTruthy();
    expect(detail.code).toBeTruthy();
  });
});
