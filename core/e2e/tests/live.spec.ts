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
 * dash.js 5.2.1 *also* reloads a dynamic MPD autonomously on its own
 * `minimumUpdatePeriod` timer, proven below - ciclo 1's conclusion that it
 * didn't was wrong (result-cycle2.md, defect 9): the actual cause was
 * calling `video.play()` immediately after `core.ready`, before dash.js's
 * PlaybackController had attached its own native `play` listener (see
 * this file's "waitForFirstLive" comment below) - the fixture's MPD was
 * never the problem, and the DASH route still uses a `duration`-based
 * SegmentTemplate anchored to real wallclock (`availabilityStartTime`) for
 * an unrelated reason: it makes segment availability computable without
 * *needing* a reload, which is what let ciclo 1's specs pass despite the
 * reload never actually happening. DASH's playheadDate is still checked
 * against real `Date.now()` (generous tolerance), not EPOCH_BASE_MS - its
 * clock is real-wallclock-relative, HLS's is purely request-count-driven.
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
 * result-cycle2.md, defect 10 - the old version of this check ("past the
 * midpoint of the window") accepted any position in the back half of the
 * window, not just the real live-sync position. `core.live.liveEdge`
 * (defect 8) is now itself that real position (hls.js `liveSyncPosition`,
 * dash.js's target-live-delay-derived edge) - assert *that*, with a
 * tolerance, and separately that it's clearly away from `seekableStart` so
 * the two can't be confused (needs a DVR window long enough that the start
 * and the edge aren't already close together - see EDGE_TEST_WINDOW below).
 */
function assertNearEdge(engine: 'hls' | 'dash', currentTime: number, live: { seekableStart: number; seekableEnd: number; liveEdge: number }): void {
  const tolerance = engine === 'hls' ? 2.5 : 6; // dash's window is wallclock-relative and keeps advancing during the assertion itself
  expect(Math.abs(currentTime - live.liveEdge)).toBeLessThan(tolerance);
  // The live-sync position itself is meaningfully away from the start of
  // the window - a structural property of the fixture/formula, not of
  // playback timing, so it can't flake the way asserting against the
  // (jittery) actual currentTime would.
  expect(live.liveEdge).toBeGreaterThan(live.seekableStart + 1);
}

// 8s: comfortably above hls.js's live-sync distance (~3s here - see
// computeLiveEdgeOffset()) and dash.js's target live delay, so the edge and
// the start of the window stay clearly distinguishable (result-cycle2.md,
// defect 10). A much longer window was tried and made dash.js's initial
// buffering stall indefinitely in this synthetic 1s-segment harness - not
// a live/dvr defect, a harness-capacity limit, so left alone.
const EDGE_TEST_WINDOW = 8;

/**
 * result-cycle2.md, defect 9 - dash.js's PlaybackController only attaches
 * its own native `play` listener once the manifest has been fetched and
 * parsed (StreamController -> PlaybackController.initialize(), confirmed by
 * reading dist/modern/umd/dash.all.debug.js); that listener is what fires
 * the *one-time* PLAYBACK_STARTED event ManifestUpdater's periodic-reload
 * timer is gated on (isPaused starts `true` and is only ever flipped by
 * PLAYBACK_STARTED - see ManifestUpdater's resetInitialSettings()/
 * _onPlaybackStarted()). Calling `video.play()` immediately after
 * `core.ready` - before that attachment happens - fires the native `play`
 * event to nobody; since a `play` event only fires again on a genuine
 * paused->playing transition, the periodic reload then never starts for
 * that whole session. This is *not* an hls.js concern (its own reload
 * cadence isn't gated on the native `play` event), so this wait is DASH-
 * specific, but applied to both engines below for one consistent call
 * pattern - it's a no-op wait for hls.js (already live on the first
 * report). This was ciclo 1's actual bug, misdiagnosed there as "dash.js
 * doesn't reload dynamic MPDs" (see result-cycle2.md "Descobertas").
 *
 * Each in-page script below inlines this as:
 *   if (!core.live.isLive) await new Promise((r) => core.addEventListener('livechange', function once() { core.removeEventListener('livechange', once); r(); }));
 * right after `await core.ready`, before calling `video.play()`.
 */

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
        // result-cycle2.md, defect 9 - wait for the engine's first live
        // report before calling play(): calling it any earlier can race
        // past dash.js's own native 'play' listener attachment, silently
        // disabling its periodic manifest reload for the rest of the
        // session (see this file's header comment).
        if (!core.live.isLive) {
          await new Promise<void>((r) => core.addEventListener('livechange', function once() {
            core.removeEventListener('livechange', once);
            r();
          }));
        }
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
      }, { src: liveUrl(engine, id, EDGE_TEST_WINDOW), warmupMs: engine === 'dash' ? 6000 : 3000 });

      // Opens near the real live-sync position, clearly away from the start.
      assertNearEdge(engine, result.openedAt, result.openedLive);

      expect(result.openedLive.isLive).toBe(true);
      expect(result.openedLive.dvr).toBe(false); // 8s window, under max(30, 2x offset)
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
      // result-cycle2.md, defect 9 - ciclo 1 concluded "dash.js 5.2.1 never
      // autonomously re-fetches a dynamic MPD in this harness"; wrong, and
      // for a mundane reason: those specs called `video.play()` immediately
      // after `core.ready`, racing past dash.js's own native `play`
      // listener attachment (see this file's header comment) - the
      // fixture's MPD was never the problem. Waiting for the first live
      // report before calling play() is enough for the real SDK to reload
      // it autonomously, headers included, and to reach DYNAMIC_TO_STATIC
      // through a genuine reload - proven below.
      test('dash: reloads live.mpd autonomously multiple times, every reload carrying the request policy header', async ({ page }, testInfo) => {
        await gotoCoreOnlyPage(page);
        const id = `reload-${testInfo.testId}`;
        const manifestPath = `/live/dash/${id}/live.mpd`;

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
          if (!core.live.isLive) {
            await new Promise<void>((r) => core.addEventListener('livechange', function once() {
              core.removeEventListener('livechange', once);
              r();
            }));
          }
          await video.play();
          await new Promise((r) => setTimeout(r, 5000));
        }, { src: liveUrl('dash', id, 8) });

        // (a) multiple autonomous reloads (the first fetch plus at least 2 more).
        expect(requests.length).toBeGreaterThanOrEqual(3);
        // (b) every one of them carries the configured header, not just the first.
        const withHeader = requests.filter((r) => r.headers()['authorization'] === 'Bearer live-token');
        expect(withHeader).toHaveLength(requests.length);
      });

      test('dash: ending the broadcast fires exactly one streamended via a real autonomous reload (DYNAMIC_TO_STATIC), no error', async ({ page }, testInfo) => {
        await gotoCoreOnlyPage(page);
        const id = `end-${testInfo.testId}`;
        const manifestPath = `/live/dash/${id}/live.mpd`;

        const requests: Request[] = [];
        page.on('request', (req) => {
          if (new URL(req.url()).pathname === manifestPath) requests.push(req);
        });

        const events = await page.evaluate(async ({ src, endUrl }) => {
          const video = document.querySelector('#video') as HTMLVideoElement;
          const core = new (window as any).UltraMediaCore(video);
          const log: string[] = [];
          core.addEventListener('streamended', () => log.push('streamended'));
          core.addEventListener('error', () => log.push('error'));
          core.load(src);
          await core.ready;
          if (!core.live.isLive) {
            await new Promise<void>((r) => core.addEventListener('livechange', function once() {
              core.removeEventListener('livechange', once);
              r();
            }));
          }
          await video.play();

          await new Promise((r) => setTimeout(r, 4000)); // a couple of autonomous reloads while live
          await fetch(endUrl);
          // dash.js needs at least one more autonomous reload (~1s cadence)
          // to see the dynamic->static transition on its own.
          await new Promise((r) => setTimeout(r, 4000));

          return log;
        }, { src: liveUrl('dash', id, 8), endUrl: `/live/control/${id}/end` });

        // (c) the transition came from a real reload, not a same-session
        // shortcut - proven by the manifest having actually been fetched
        // again after the control endpoint ended the stream.
        expect(requests.length).toBeGreaterThanOrEqual(3);
        expect(events.filter((e) => e === 'streamended')).toHaveLength(1);
        expect(events.filter((e) => e === 'error')).toHaveLength(0);
      });

      // A separate, still-valid scenario: loading a manifest that was
      // already ended *before* this session ever started (a host
      // reinitializing playback against a VOD-ified past broadcast).
      test('dash: a manifest that already ended loads as isLive:false via the real SDK, with no error', async ({ page }, testInfo) => {
        const id = `end-preloaded-${testInfo.testId}`;
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
          if (!core.live.isLive) {
            await new Promise<void>((r) => core.addEventListener('livechange', function once() {
              core.removeEventListener('livechange', once);
              r();
            }));
          }
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
      await setSrc(page, liveUrl(engine, id, EDGE_TEST_WINDOW));

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
