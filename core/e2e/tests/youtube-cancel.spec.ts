import type { Page } from '@playwright/test';
import { test, expect } from '../utils/hermetic';
import { gotoPlayer, setSrc } from '../utils/media';

// Must match src/core/sdk-config.ts exactly (see its own comment: neither
// Google nor YouTube offers a versioned/pinned URL for this one, so there's
// nothing to pin - just the bare URL to intercept here).
const YOUTUBE_IFRAME_API_URL = 'https://www.youtube.com/iframe_api';

// Long enough that three back-to-back setSrc() calls (each just a
// page.evaluate() round trip) are guaranteed to land well before the (stubbed)
// IFrame API "finishes loading", opening the same kind of race window
// pending-load-cancel.spec.ts's SDK_DELAY_MS exercises for hls.js/dash.js.
const API_DELAY_MS = 2000;

/**
 * Intercepts the real (non-versioned) YouTube IFrame API URL with a local,
 * delayed stub instead of loosening the hermetic guard: registered here,
 * inside the test, it takes priority over hermetic.ts's own blocking `**\/*`
 * route (Playwright runs the most-recently-registered matching handler
 * first - the same technique pending-load-cancel.spec.ts's delaySdkResponse()
 * already uses for the hls.js/dash.js CDN URLs). The request is answered
 * entirely locally and never reaches the network, so hermetic.ts's own
 * violation check never even sees it - no change to hermetic.ts itself.
 *
 * The stub defines `window.YT` with a fake `Player` that records every
 * videoId it's constructed with into `window.__ytCreated`, then invokes
 * `window.onYouTubeIframeAPIReady()` - the two things
 * youtube-player.ts's loadYouTubeAPI() actually depends on.
 */
async function stubYouTubeIframeApi(page: Page, delayMs = API_DELAY_MS): Promise<void> {
  // The fake YT.Player above still sets a real `<iframe src="https://www.
  // youtube.com/embed/...">` (youtube-player.ts's own createPlayer() does,
  // unstubbed - not worth faking too, only the navigation target matters
  // here) - stub that host too, same restricted/local-only technique, so a
  // *correctly* created single iframe doesn't itself trip the hermetic
  // guard's real-network check.
  await page.route('https://www.youtube.com/embed/**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: '<!doctype html><title>stub</title>' });
  });

  await page.route(YOUTUBE_IFRAME_API_URL, async (route) => {
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    await route.fulfill({
      status: 200,
      contentType: 'application/javascript; charset=utf-8',
      body: `
        window.__ytCreated = window.__ytCreated || [];
        window.YT = {
          PlayerState: { PLAYING: 1, PAUSED: 2, ENDED: 0, BUFFERING: 3 },
          Player: function (el, options) {
            window.__ytCreated.push(options.videoId);
            this.playVideo = function () {};
            this.pauseVideo = function () {};
            this.mute = function () {};
            this.unMute = function () {};
            this.seekTo = function () {};
            this.setVolume = function () {};
            this.setPlaybackRate = function () {};
            this.destroy = function () {};
            this.getCurrentTime = function () { return 0; };
            this.getDuration = function () { return 0; };
            this.getPlayerState = function () { return 2; };
            this.isMuted = function () { return false; };
            this.getVolume = function () { return 100; };
            this.getPlaybackRate = function () { return 1; };
            this.getVideoLoadedFraction = function () { return 0; };
            var self = this;
            setTimeout(function () {
              if (options.events && options.events.onReady) options.events.onReady({ target: self });
            }, 0);
          },
        };
        if (typeof window.onYouTubeIframeAPIReady === 'function') {
          window.onYouTubeIframeAPIReady();
        }
      `,
    });
  });
}

function getCreated(page: Page): Promise<string[]> {
  return page.evaluate(() => (window as unknown as { __ytCreated?: string[] }).__ytCreated ?? []);
}

test.describe('youtube: cancel stale sources while the IFrame API is still loading', () => {
  // Three src changes (same format throughout, so UltraMediaElement reuses
  // the one YouTubePlayer instance and just calls load() again) before the
  // stubbed API resolves - before the fix, each load() chained its own
  // `.onReady.then(...)`, so all three survived and created a player each.
  test('rapid src swap (A -> B -> C) before the API is ready only creates a player for C', async ({ page }) => {
    test.setTimeout(60_000);
    await gotoPlayer(page);
    await stubYouTubeIframeApi(page);

    await setSrc(page, 'https://www.youtube.com/watch?v=AAAAAAAAAAA');
    await setSrc(page, 'https://www.youtube.com/watch?v=BBBBBBBBBBB');
    await setSrc(page, 'https://www.youtube.com/watch?v=CCCCCCCCCCC');

    await expect.poll(async () => (await getCreated(page)).length, { timeout: API_DELAY_MS + 20_000 }).toBeGreaterThan(0);
    // Give any (incorrect) extra creation a moment to show up too.
    await new Promise((resolve) => setTimeout(resolve, 500));

    expect(await getCreated(page)).toEqual(['CCCCCCCCCCC']);
  });

  // The public destroy() API, called before the stubbed IFrame API resolves,
  // must leave no player/iframe behind once it does.
  test('destroy() before the API is ready creates no player', async ({ page }) => {
    test.setTimeout(60_000);
    await gotoPlayer(page);
    await stubYouTubeIframeApi(page);

    await setSrc(page, 'https://www.youtube.com/watch?v=AAAAAAAAAAA');
    await page.evaluate(() => (document.querySelector('#player') as any).destroy());

    await new Promise((resolve) => setTimeout(resolve, API_DELAY_MS + 1000));

    expect(await getCreated(page)).toEqual([]);
    expect(await page.evaluate(() => document.querySelector('#player')?.shadowRoot?.querySelector('iframe') ?? null)).toBeNull();
  });

  // Same race, triggered by removing the element from the DOM (an *effective*
  // disconnect - the teardown microtask actually runs destroy()) instead of
  // an explicit destroy() call.
  test('removing the element before the API is ready creates no player', async ({ page }) => {
    test.setTimeout(60_000);
    await gotoPlayer(page);
    await stubYouTubeIframeApi(page);

    await setSrc(page, 'https://www.youtube.com/watch?v=AAAAAAAAAAA');
    await page.evaluate(() => document.querySelector('#player')!.remove());
    // Let disconnectedCallback's teardown microtask actually run.
    await new Promise((resolve) => setTimeout(resolve, 200));

    await new Promise((resolve) => setTimeout(resolve, API_DELAY_MS + 1000));

    expect(await getCreated(page)).toEqual([]);
  });
});
