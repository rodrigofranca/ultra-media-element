import type { Page } from '@playwright/test';

// Must match src/core/sdk-config.ts exactly (see its own comment: neither
// Google nor YouTube offers a versioned/pinned URL for this one, so there's
// nothing to pin - just the bare URL to intercept here).
export const YOUTUBE_IFRAME_API_URL = 'https://www.youtube.com/iframe_api';

// Long enough that a handful of page.evaluate() round trips are guaranteed
// to land well before the (stubbed) IFrame API "finishes loading", opening
// the same kind of race window pending-load-cancel.spec.ts's SDK_DELAY_MS
// exercises for hls.js/dash.js.
export const YOUTUBE_API_DELAY_MS = 2000;

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
 *
 * Shared by e2e/tests/youtube-cancel.spec.ts and
 * e2e/tests/headless-core.spec.ts (cycle 3, defect 1 - the "stub hermético
 * da IFrame API já existente no e2e" the brief points at).
 */
export async function stubYouTubeIframeApi(page: Page, delayMs = YOUTUBE_API_DELAY_MS): Promise<void> {
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

export function getYouTubeCreated(page: Page): Promise<string[]> {
  return page.evaluate(() => (window as unknown as { __ytCreated?: string[] }).__ytCreated ?? []);
}
