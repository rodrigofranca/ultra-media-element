import type { Page, Request } from '@playwright/test';
import { test, expect } from '../utils/hermetic';
import { gotoPlayer, setSrc, getLog, instrument, getProp, callMethod } from '../utils/media';

/**
 * ADR-0001 D5 - proves live behavior against the synthetic, hermetic
 * fixture in e2e/server/live-fixture.mjs (see its header comment for how
 * the window/clock work per engine). One streamId per test
 * (testInfo.testId) so parallel workers never share state.
 *
 * hls.js reloads its live playlist autonomously (~once per target
 * duration - LEVEL_LOADED), so live-fixture.mjs's HLS route is fully
 * request-count-driven and deterministic: EPOCH_BASE_MS below mirrors it
 * exactly, and playheadDate assertions check that precise formula.
 *
 * dash.js 5.2.1 did not, in this harness (confirmed empirically - see
 * live-fixture.mjs's buildDashMpd() comment), reliably re-fetch a dynamic
 * MPD on its own `minimumUpdatePeriod` timer; the DASH route instead uses a
 * plain `duration`-based SegmentTemplate anchored to *real* wallclock
 * (`availabilityStartTime`), needing no reload for new segments to become
 * known. Two consequences for the specs below: DASH's playheadDate is
 * checked against real `Date.now()` (generous tolerance), not
 * EPOCH_BASE_MS; and DASH's "ending the broadcast" spec reloads the source
 * explicitly after calling the control endpoint (a host that ends a live
 * event out-of-band and re-initializes playback), rather than waiting for
 * an autonomous reload that wasn't observed to happen here.
 */
const EPOCH_BASE_MS = Date.UTC(2026, 0, 1, 0, 0, 0); // HLS only

function liveUrl(engine: 'hls' | 'dash', id: string, window?: number): string {
  const file = engine === 'hls' ? 'live.m3u8' : 'live.mpd';
  const q = window ? `?window=${window}` : '';
  return `/live/${engine}/${id}/${file}${q}`;
}

async function gotoCoreOnlyPage(page: Page): Promise<void> {
  await page.goto('/core-only.html');
  await page.waitForFunction(() => (window as any).UltraMediaCore !== undefined);
}

function assertPlayheadDate(engine: 'hls' | 'dash', playheadDate: string, currentTime: number): void {
  const actual = new Date(playheadDate).getTime();
  if (engine === 'hls') {
    expect(Math.abs(actual - (EPOCH_BASE_MS + currentTime * 1000))).toBeLessThan(2500);
  } else {
    expect(Math.abs(actual - Date.now())).toBeLessThan(15_000);
  }
}

/**
 * HLS's live-fixture window is capped at a fixed segment count (see
 * live-fixture.mjs's windowSegments()), so "closer to the end than the
 * start of that fixed range" is a stable, meaningful check. DASH's window
 * (buildDashMpd()) is wallclock-relative and keeps growing for as long as
 * the test waits - "the midpoint" is a moving target there, so the
 * meaningful check instead is that the *live latency* (how far currentTime
 * trails the ever-advancing edge) stays small and bounded, exactly what a
 * real live player's own safety buffer looks like.
 */
function assertNearEdge(engine: 'hls' | 'dash', currentTime: number, live: { seekableStart: number; seekableEnd: number }): void {
  if (engine === 'hls') {
    expect(currentTime).toBeGreaterThan((live.seekableStart + live.seekableEnd) / 2);
  } else {
    expect(live.seekableEnd - currentTime).toBeLessThan(9);
  }
}

const ENGINES = ['hls', 'dash'] as const;

test.describe('headless core: live (ADR-0001 D5)', () => {
  test.describe.configure({ timeout: 45_000 });

  for (const engine of ENGINES) {
    test(`${engine}: opens at the live edge, isLive true, dvr false under the window, playheadDate tracks PDT/UTC, seek back + goToLive() returns to the edge`, async ({ page }, testInfo) => {
      await gotoCoreOnlyPage(page);
      const id = `edge-${testInfo.testId}`;

      const result = await page.evaluate(async ({ src, warmupMs }) => {
        const video = document.querySelector('#video') as HTMLVideoElement;
        const core = new (window as any).UltraMediaCore(video); // 'auto' - proves real manifest-driven detection
        core.load(src);
        await core.ready;
        await video.play();

        // Enough real time for playback to progress into the buffered
        // window near the live edge. dash.js ramps up noticeably slower
        // than hls.js in this harness (larger initial live delay).
        await new Promise((r) => setTimeout(r, warmupMs));

        const openedAt = video.currentTime;
        const openedLive = { ...core.live };

        // Seek back toward the start of the seekable window, then return.
        video.currentTime = core.live.seekableStart + 0.2;
        await new Promise((r) => setTimeout(r, 300));
        const afterSeekBack = video.currentTime;

        core.goToLive();
        await new Promise((r) => setTimeout(r, 300));
        const afterGoToLive = video.currentTime;

        return { openedAt, openedLive, afterSeekBack, afterGoToLive };
      }, { src: liveUrl(engine, id, 8), warmupMs: engine === 'dash' ? 6000 : 3000 });

      // Opens closer to the live edge than to the start of the window.
      assertNearEdge(engine, result.openedAt, result.openedLive);

      expect(result.openedLive.isLive).toBe(true);
      expect(result.openedLive.dvr).toBe(false); // 8s window, under the 30s threshold
      expect(result.openedLive.seekableEnd).toBeGreaterThan(result.openedLive.seekableStart);

      assertPlayheadDate(engine, result.openedLive.playheadDate, result.openedAt);

      // Seeking back actually moved the playhead...
      expect(result.afterSeekBack).toBeLessThan(result.openedAt);
      // ...and goToLive() brought it back near the edge.
      expect(result.afterGoToLive).toBeGreaterThan(result.afterSeekBack);
      assertNearEdge(engine, result.afterGoToLive, result.openedLive);
    });

    test(`${engine}: dvr reflects the seekable window (short window -> false, long window -> true)`, async ({ page }, testInfo) => {
      await gotoCoreOnlyPage(page);
      const shortId = `dvr-short-${testInfo.testId}`;
      const longId = `dvr-long-${testInfo.testId}`;

      const short = await page.evaluate(async ({ src }) => {
        const video = document.querySelector('#video') as HTMLVideoElement;
        const core = new (window as any).UltraMediaCore(video);
        core.load(src);
        await core.ready;
        await new Promise((r) => setTimeout(r, 500));
        const snapshot = { ...core.live };
        core.destroy();
        return snapshot;
      }, { src: liveUrl(engine, shortId, 3) });
      expect(short.dvr).toBe(false);

      const long = await page.evaluate(async ({ src }) => {
        const video = document.querySelector('#video') as HTMLVideoElement;
        const core = new (window as any).UltraMediaCore(video);
        core.load(src);
        await core.ready;
        await new Promise((r) => setTimeout(r, 500));
        const snapshot = { ...core.live };
        core.destroy();
        return snapshot;
      }, { src: liveUrl(engine, longId, 35) });
      expect(long.dvr).toBe(true);
      expect(long.seekableEnd - long.seekableStart).toBeGreaterThan(30);
    });

    if (engine === 'hls') {
      test('hls: ending the broadcast (ENDLIST on the next autonomous reload) fires exactly one streamended, and no error', async ({ page }, testInfo) => {
        await gotoCoreOnlyPage(page);
        const id = `end-${testInfo.testId}`;

        const events = await page.evaluate(async ({ src, endUrl }) => {
          const video = document.querySelector('#video') as HTMLVideoElement;
          const core = new (window as any).UltraMediaCore(video);
          const log: string[] = [];
          core.addEventListener('streamended', () => log.push('streamended'));
          core.addEventListener('error', () => log.push('error'));
          core.load(src);
          await core.ready;
          await video.play();

          await new Promise((r) => setTimeout(r, 1500)); // a couple of reloads while live
          await fetch(endUrl);
          // hls.js needs at least one more reload (~1s cadence) to see the
          // ENDLIST transition on its own.
          await new Promise((r) => setTimeout(r, 3000));

          return log;
        }, { src: liveUrl('hls', id, 3), endUrl: `/live/control/${id}/end` });

        expect(events.filter((e) => e === 'streamended')).toHaveLength(1);
        expect(events.filter((e) => e === 'error')).toHaveLength(0);
      });
    } else {
      // Descoberta (see result.md "fixture live"): dash.js 5.2.1 never
      // autonomously re-fetched a dynamic MPD in this harness (confirmed:
      // 0 reloads observed over 16s of real playback with
      // minimumUpdatePeriod="PT1S" declared and correctly parsed), so the
      // live -> static *transition* within one continuous playback session
      // can't be driven through a real browser here - only proven at the
      // unit level (dash-player.test.ts, mocked DYNAMIC_TO_STATIC). This
      // spec instead proves the other half through the real SDK end to
      // end: a stream the control endpoint already ended loads as
      // isLive:false (dash.js's real isDynamic() on a real static MPD),
      // with no error - core.load()/DashPlayer.load() deliberately reset
      // `wasLive` to false on every load() (ADR-0001 D5 - "volta ao estado
      // neutro... troca de fonte"), which is exactly what makes a same-
      // session transition unobservable without an autonomous reload.
      test('dash: a manifest that already ended loads as isLive:false via the real SDK, with no error', async ({ page }, testInfo) => {
        const id = `end-${testInfo.testId}`;
        await page.request.get(liveUrl('dash', id, 3)); // instantiates stream state
        await page.request.get(`/live/control/${id}/end`);

        await gotoCoreOnlyPage(page);
        const result = await page.evaluate(async (src) => {
          const video = document.querySelector('#video') as HTMLVideoElement;
          const core = new (window as any).UltraMediaCore(video);
          const log: string[] = [];
          core.addEventListener('error', () => log.push('error'));
          core.load(src);
          await core.ready;
          await new Promise((r) => setTimeout(r, 800));
          return { isLive: core.live.isLive, log };
        }, liveUrl('dash', id, 3));

        expect(result.isLive).toBe(false);
        expect(result.log).toHaveLength(0);
      });
    }

    if (engine === 'hls') {
      test('hls: request policy headers are present on every playlist reload, not just the first', async ({ page }, testInfo) => {
        await gotoCoreOnlyPage(page);
        const id = `headers-${testInfo.testId}`;
        const manifestPath = `/live/hls/${id}/live.m3u8`;

        const requests: Request[] = [];
        page.on('request', (req) => {
          if (new URL(req.url()).pathname === manifestPath) requests.push(req);
        });

        await page.evaluate(async ({ src }) => {
          const video = document.querySelector('#video') as HTMLVideoElement;
          const core = new (window as any).UltraMediaCore(video, {
            request: { headers: { Authorization: 'Bearer live-token' } },
          });
          core.load(src);
          await core.ready;
          await video.play();
          await new Promise((r) => setTimeout(r, 3000));
        }, { src: liveUrl('hls', id, 3) });

        expect(requests.length).toBeGreaterThanOrEqual(2); // proves at least one reload, not just the first fetch
        const withHeader = requests.filter((r) => r.headers()['authorization'] === 'Bearer live-token');
        expect(withHeader).toHaveLength(requests.length);
      });
    } else {
      test('dash: request policy headers are present on every segment fetch as the live edge advances, not just the manifest', async ({ page }, testInfo) => {
        await gotoCoreOnlyPage(page);
        const id = `headers-${testInfo.testId}`;

        const requests: Request[] = [];
        page.on('request', (req) => {
          if (new URL(req.url()).pathname.startsWith(`/live/dash/${id}/`)) requests.push(req);
        });

        await page.evaluate(async ({ src }) => {
          const video = document.querySelector('#video') as HTMLVideoElement;
          const core = new (window as any).UltraMediaCore(video, {
            request: { headers: { Authorization: 'Bearer live-token' } },
          });
          core.load(src);
          await core.ready;
          await video.play();
          await new Promise((r) => setTimeout(r, 3000));
        }, { src: liveUrl('dash', id, 3) });

        // manifest + init + several segments as the edge advances (proves this isn't just the first fetch)
        expect(requests.length).toBeGreaterThanOrEqual(4);
        const withHeader = requests.filter((r) => r.headers()['authorization'] === 'Bearer live-token');
        expect(withHeader).toHaveLength(requests.length);
      });
    }
  }
});

test.describe('<ultra-media> element: live (ADR-0001 D5)', () => {
  test.describe.configure({ timeout: 40_000 });

  for (const engine of ENGINES) {
    test(`${engine}: the "live" attribute drives isLive/liveInfo, goToLive() and livechange re-dispatch`, async ({ page }, testInfo) => {
      await gotoPlayer(page);
      await instrument(page);
      const id = `element-${testInfo.testId}`;

      await page.evaluate(() => document.querySelector('#player')!.setAttribute('live', ''));
      await setSrc(page, liveUrl(engine, id, 8));

      await expect.poll(async () => getProp(page, 'isLive'), { timeout: 10_000 }).toBe(true);
      await expect.poll(async () => (await getLog(page)).some((e) => e.name === 'livechange'), { timeout: 10_000 }).toBe(true);

      await callMethod(page, 'play');
      await new Promise((r) => setTimeout(r, engine === 'dash' ? 6000 : 2000));

      const liveInfo = await getProp(page, 'liveInfo') as { seekableStart: number; seekableEnd: number };
      const currentTime = await getProp(page, 'currentTime') as number;
      assertNearEdge(engine, currentTime, liveInfo);

      await page.evaluate(() => { (document.querySelector('#player') as any).currentTime = 0.2; });
      await callMethod(page, 'goToLive');
      await new Promise((r) => setTimeout(r, 300));
      const afterGoToLive = await getProp(page, 'currentTime') as number;
      expect(afterGoToLive).toBeGreaterThan(0.5);
      assertNearEdge(engine, afterGoToLive, liveInfo);
      expect((await getLog(page)).filter((e) => e.name === 'error')).toHaveLength(0);
    });
  }

  test('hls: ending the broadcast re-dispatches exactly one "streamended" CustomEvent', async ({ page }, testInfo) => {
    await gotoPlayer(page);
    await instrument(page);
    const id = `element-end-${testInfo.testId}`;

    await page.evaluate(() => document.querySelector('#player')!.setAttribute('live', ''));
    await setSrc(page, liveUrl('hls', id, 3));
    await expect.poll(async () => getProp(page, 'isLive'), { timeout: 10_000 }).toBe(true);
    await callMethod(page, 'play');

    await page.request.get(`/live/control/${id}/end`);
    await expect.poll(async () => (await getLog(page)).filter((e) => e.name === 'streamended').length, { timeout: 8_000 }).toBe(1);
    expect((await getLog(page)).filter((e) => e.name === 'error')).toHaveLength(0);
  });
});

test.describe('media-chrome gate: live (ADR-0001 D3/D5)', () => {
  test('media-live-button reflects being off/at the edge, and clicking it returns to live', async ({ page }, testInfo) => {
    test.setTimeout(45_000);
    const id = `mediachrome-${testInfo.testId}`;

    await page.goto('/media-chrome-player.html');
    await page.waitForFunction(() => customElements.get('media-controller') !== undefined);

    await page.evaluate(() => document.querySelector('#player')!.setAttribute('live', ''));
    await page.evaluate((src) => document.querySelector('#player')!.setAttribute('src', src), liveUrl('hls', id, 8));

    const liveButton = page.locator('media-live-button');
    await expect.poll(async () => page.evaluate(() => (document.querySelector('#player') as any).isLive), { timeout: 10_000 }).toBe(true);

    await page.evaluate(() => document.querySelector('media-play-button')!.dispatchEvent(new Event('click', { bubbles: true, composed: true })));
    await new Promise((r) => setTimeout(r, 1500));

    // Seek back, away from the edge - the button must reflect "not live"
    // (mediatimeislive absent - MediaUIAttributes.MEDIA_TIME_IS_LIVE).
    await page.evaluate(() => { (document.querySelector('#player') as any).currentTime = 0.2; });
    await expect.poll(async () => liveButton.getAttribute('mediatimeislive'), { timeout: 5_000 }).toBeNull();

    // Clicking it dispatches mediaseektoliverequest, which media-chrome
    // turns into a currentTime set near the live edge (state-mediator.js).
    await liveButton.click();
    await expect.poll(async () => page.evaluate(() => (document.querySelector('#player') as any).currentTime), { timeout: 10_000 })
      .toBeGreaterThan(0.5);
    await expect.poll(async () => liveButton.getAttribute('mediatimeislive'), { timeout: 5_000 }).not.toBeNull();
  });
});
