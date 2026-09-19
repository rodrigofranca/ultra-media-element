import type { Page } from '@playwright/test';
import { test, expect } from '../utils/hermetic';
import fixtureManifest from '../fixtures/manifest.json' with { type: 'json' };
import { stubYouTubeIframeApi } from '../utils/youtube-stub';

// ADR-0001 delivery plan step 2: drives UltraMediaCore on a bare <video>
// with *no custom element registered at all* - the actual proof that the
// /core entry is headless, not just "doesn't import ads". Everything here
// goes through the raw `UltraMediaCore` API (page.evaluate), not the
// <ultra-media> attribute surface e2e/utils/media.ts's helpers target.
const MP4_FIXTURE = '/fixtures/mp4/sample.mp4';
const HLS_FIXTURE = '/fixtures/hls/master.m3u8';
const DASH_FIXTURE = '/fixtures/dash/manifest.mpd';
const MISSING_HLS_MANIFEST = '/fixtures/hls/does-not-exist.m3u8';

async function gotoCoreOnlyPage(page: Page): Promise<void> {
  await page.goto('/core-only.html');
  await page.waitForFunction(() => (window as any).UltraMediaCore !== undefined);
}

test.describe('headless UltraMediaCore on a bare <video>', () => {
  test('customElements.get("ultra-media") is undefined on this page', async ({ page }) => {
    await gotoCoreOnlyPage(page);
    const defined = await page.evaluate(() => customElements.get('ultra-media') !== undefined);
    expect(defined).toBe(false);
  });

  test('plays mp4', async ({ page }) => {
    await gotoCoreOnlyPage(page);
    const result = await page.evaluate(async ({ fixture }) => {
      const video = document.querySelector('#video') as HTMLVideoElement;
      const core = new (window as any).UltraMediaCore(video);
      core.load(fixture);
      await core.ready;
      await video.play();
      await new Promise((r) => setTimeout(r, 300));
      return { duration: video.duration, currentTime: video.currentTime, engine: core.engine, format: core.format };
    }, { fixture: MP4_FIXTURE });

    expect(result.duration).toBeCloseTo(fixtureManifest.duration, 0);
    expect(result.currentTime).toBeGreaterThan(0);
    expect(result.engine).toBe('video/mp4');
    expect(result.format).toBe('mp4');
  });

  test('plays hls and exposes the right renditions/audio tracks', async ({ page }) => {
    await gotoCoreOnlyPage(page);
    const result = await page.evaluate(async ({ fixture }) => {
      const video = document.querySelector('#video') as HTMLVideoElement;
      const core = new (window as any).UltraMediaCore(video);
      core.load(fixture);
      await core.ready;
      await new Promise((resolve) => {
        const check = () => (core.renditions.length > 0 ? resolve(undefined) : setTimeout(check, 50));
        check();
      });
      await video.play();
      await new Promise((r) => setTimeout(r, 500));
      return {
        currentTime: video.currentTime,
        engine: core.engine,
        renditions: [...core.renditions].map((r: any) => ({ width: r.width, height: r.height })).sort((a: any, b: any) => b.width - a.width),
        audioTracks: core.audioTracks.length,
      };
    }, { fixture: HLS_FIXTURE });

    expect(result.currentTime).toBeGreaterThan(0);
    expect(result.engine).toBe('hls.js');
    expect(result.renditions).toEqual([...fixtureManifest.hls.renditions].sort((a, b) => b.width - a.width));
    expect(result.audioTracks).toBe(fixtureManifest.hls.audioTracks);
  });

  test('plays dash and exposes the right renditions', async ({ page }) => {
    await gotoCoreOnlyPage(page);
    const result = await page.evaluate(async ({ fixture }) => {
      const video = document.querySelector('#video') as HTMLVideoElement;
      const core = new (window as any).UltraMediaCore(video);
      core.load(fixture);
      await core.ready;
      await new Promise((resolve) => {
        const check = () => (core.renditions.length > 0 ? resolve(undefined) : setTimeout(check, 50));
        check();
      });
      await video.play();
      await new Promise((r) => setTimeout(r, 500));
      return {
        currentTime: video.currentTime,
        engine: core.engine,
        renditionCount: core.renditions.length,
      };
    }, { fixture: DASH_FIXTURE });

    expect(result.currentTime).toBeGreaterThan(0);
    expect(result.engine).toBe('dash.js');
    expect(result.renditionCount).toBe(fixtureManifest.dash.videoRepresentationsInAdaptationSet);
  });

  test('swaps source across formats on the same core instance (mp4 -> hls -> dash)', async ({ page }) => {
    await gotoCoreOnlyPage(page);
    const result = await page.evaluate(async ({ mp4, hls, dash }) => {
      const video = document.querySelector('#video') as HTMLVideoElement;
      const core = new (window as any).UltraMediaCore(video);
      const engines: string[] = [];

      core.load(mp4);
      await core.ready;
      engines.push(core.engine);

      core.load(hls);
      await core.ready;
      engines.push(core.engine);

      core.load(dash);
      await core.ready;
      engines.push(core.engine);

      await video.play();
      await new Promise((r) => setTimeout(r, 300));

      return { engines, currentTime: video.currentTime, format: core.format };
    }, { mp4: MP4_FIXTURE, hls: HLS_FIXTURE, dash: DASH_FIXTURE });

    expect(result.engines).toEqual(['video/mp4', 'hls.js', 'dash.js']);
    expect(result.format).toBe('dash');
    expect(result.currentTime).toBeGreaterThan(0);
  });

  test('destroy() stops segment downloads and leaves the <video> reusable by a second UltraMediaCore', async ({ page }) => {
    await gotoCoreOnlyPage(page);

    const requests: number[] = [];
    await page.route('**/fixtures/hls/**/*.m4s', async (route) => {
      requests.push(Date.now());
      await new Promise((r) => setTimeout(r, 200));
      await route.continue();
    });

    await page.evaluate(async ({ fixture }) => {
      const video = document.querySelector('#video') as HTMLVideoElement;
      const core = new (window as any).UltraMediaCore(video);
      (window as any).__firstCore = core;
      core.load(fixture);
      await core.ready;
    }, { fixture: HLS_FIXTURE });

    await expect.poll(() => requests.length, { timeout: 10_000 }).toBeGreaterThan(0);

    await page.evaluate(() => (window as any).__firstCore.destroy());
    const countAtDestroy = requests.length;

    // Proving a *negative* (no more requests from the first core) needs a
    // fixed real-time observation window, not an event to poll for.
    await new Promise((resolve) => setTimeout(resolve, 1000));
    expect(requests.length).toBe(countAtDestroy);

    // A brand new UltraMediaCore, on the exact same <video> the first core
    // just tore down - this is the raw guarantee ADR-0001 D1 makes ("mediaEl
    // is left clean and reusable"), independent of any element/shell.
    const secondCoreResult = await page.evaluate(async ({ fixture }) => {
      const video = document.querySelector('#video') as HTMLVideoElement;
      const core = new (window as any).UltraMediaCore(video);
      core.load(fixture);
      await core.ready;
      await video.play();
      await new Promise((r) => setTimeout(r, 500));
      return { currentTime: video.currentTime, engine: core.engine };
    }, { fixture: HLS_FIXTURE });

    expect(secondCoreResult.engine).toBe('hls.js');
    expect(secondCoreResult.currentTime).toBeGreaterThan(0);
  });

  // `core.ready` isn't asserted here - it settles once the hls.js SDK script
  // itself has loaded (UltraMediaCore.wireUp() proxies IMediaPlayer.onReady
  // 1:1, see result.md "API final do UltraMediaCore"), which happens well
  // before hls.js's own manifest-fetch retry policy gives up and reports
  // this as fatal; it does not track "this specific source loaded".
  test('a fatal 404 manifest error emits "error" with the same detail shape', async ({ page }) => {
    test.setTimeout(30_000);
    await gotoCoreOnlyPage(page);

    await page.evaluate(({ fixture }) => {
      const video = document.querySelector('#video') as HTMLVideoElement;
      const core = new (window as any).UltraMediaCore(video);
      (window as any).__errors = [];
      core.addEventListener('error', (e: any) => (window as any).__errors.push(e.detail));
      core.load(fixture);
    }, { fixture: MISSING_HLS_MANIFEST });

    await expect.poll(
      async () => page.evaluate(() => (window as any).__errors.length),
      { timeout: 15_000 }
    ).toBeGreaterThan(0);

    const errors = await page.evaluate(() => (window as any).__errors);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({ fatal: true, status: 404, engine: 'hls.js' });
  });
});

// cycle 2, defect 4: PlayerFactory.create() used to write `element.
// dataset.type` but nothing removed it - `getCurrentFormatFromElement
// (media)` (and anything else reading `dataset.type` straight off the
// <video>) kept reporting the old format forever, even after destroy().
// Cycle 3, defect 1 went further: PlayerFactory doesn't write data-type at
// all any more (the core learns the engine without touching the DOM), and
// UltraMediaCore now generically snapshots/restores the one other DOM
// property a player can change outside `src` (style.display, in
// YouTubePlayer's case). Compares the <video>'s own attributes/inline style
// before `new UltraMediaCore()` and after `destroy()` - must be identical
// (the rule: "media ends up exactly as the core found it" - src included,
// since destroy() also fully clears it, per defect 1).
test.describe('destroy() leaves the <video> exactly as it found it (cycle 2, defect 4)', () => {
  const CASES = [
    { engine: 'hls', fixture: HLS_FIXTURE },
    { engine: 'dash', fixture: DASH_FIXTURE },
    { engine: 'mp4', fixture: MP4_FIXTURE },
  ];

  for (const { engine, fixture } of CASES) {
    test(`(${engine})`, async ({ page }) => {
      await gotoCoreOnlyPage(page);

      const result = await page.evaluate(async ({ fixture }) => {
        const video = document.querySelector('#video') as HTMLVideoElement;
        const snapshot = () => ({
          attributes: [...video.attributes].map((a) => `${a.name}=${a.value}`).sort(),
          inlineStyle: video.getAttribute('style'),
        });

        const before = snapshot();

        const core = new (window as any).UltraMediaCore(video);
        core.load(fixture);
        await core.ready;
        await new Promise((r) => setTimeout(r, 300));
        core.destroy();

        return { before, after: snapshot() };
      }, { fixture });

      expect(result.after).toEqual(result.before);
    });
  }

  // cycle 3, defect 1: same proof, but seeded with a host's own
  // pre-existing attributes - the literal scenario the brief describes
  // (`<video data-type="do-host" style="display:block"
  // crossorigin="anonymous">`). Before this fix, PlayerFactory clobbered
  // data-type with its own engine name and teardownPlayer() deleted it
  // outright on teardown; YouTubePlayer's destroy() reset style.display to
  // '' instead of the host's original 'block'.
  test.describe('destroy() preserves a host\'s own pre-existing attributes (cycle 3, defect 1)', () => {
    async function seedHostAttributes(page: Page): Promise<void> {
      await page.evaluate(() => {
        const video = document.querySelector('#video') as HTMLVideoElement;
        video.setAttribute('data-type', 'do-host');
        video.style.display = 'block';
        video.setAttribute('crossorigin', 'anonymous');
      });
    }

    const ATTR_CASES = [
      { engine: 'hls', fixture: HLS_FIXTURE },
      { engine: 'dash', fixture: DASH_FIXTURE },
      { engine: 'mp4', fixture: MP4_FIXTURE },
    ];

    for (const { engine, fixture } of ATTR_CASES) {
      test(`(${engine})`, async ({ page }) => {
        await gotoCoreOnlyPage(page);
        await seedHostAttributes(page);

        const result = await page.evaluate(async ({ fixture }) => {
          const video = document.querySelector('#video') as HTMLVideoElement;
          const snapshot = () => ({
            attributes: [...video.attributes].map((a) => `${a.name}=${a.value}`).sort(),
            inlineStyle: video.getAttribute('style'),
          });

          const before = snapshot();

          const core = new (window as any).UltraMediaCore(video);
          core.load(fixture);
          await core.ready;
          await new Promise((r) => setTimeout(r, 300));
          core.destroy();

          return { before, after: snapshot() };
        }, { fixture });

        expect(result.after).toEqual(result.before);
        // Sanity-check the seed actually landed, so a broken seed can't
        // make this pass vacuously.
        expect(result.before.attributes).toEqual(expect.arrayContaining(['data-type=do-host', 'crossorigin=anonymous']));
        expect(result.before.inlineStyle).toContain('display');
      });
    }

    test('(youtube, via the hermetic IFrame API stub)', async ({ page }) => {
      await gotoCoreOnlyPage(page);
      await stubYouTubeIframeApi(page);
      await seedHostAttributes(page);
      await page.evaluate(() => {
        document.body.appendChild(document.createElement('div')).id = 'yt-container';
      });

      const result = await page.evaluate(async () => {
        const video = document.querySelector('#video') as HTMLVideoElement;
        const container = document.querySelector('#yt-container') as HTMLDivElement;
        const snapshot = () => ({
          attributes: [...video.attributes].map((a) => `${a.name}=${a.value}`).sort(),
          inlineStyle: video.getAttribute('style'),
        });

        const before = snapshot();

        const core = new (window as any).UltraMediaCore(video, { container });
        core.load('https://www.youtube.com/watch?v=AAAAAAAAAAA');
        await core.ready;
        await new Promise((r) => setTimeout(r, 300));
        core.destroy();

        return { before, after: snapshot() };
      });

      expect(result.after).toEqual(result.before);
    });
  });

  // The unit-level proof (tests/ultra-media-core.test.ts) already covers the
  // throw itself against a fake player; this confirms it holds against a
  // real, loaded engine too, and that sequential reuse still works.
  test('a second UltraMediaCore on the same, still-attached <video> throws; sequential reuse after destroy() works', async ({ page }) => {
    await gotoCoreOnlyPage(page);

    const result = await page.evaluate(async ({ fixture }) => {
      const video = document.querySelector('#video') as HTMLVideoElement;
      const first = new (window as any).UltraMediaCore(video);
      first.load(fixture);
      await first.ready;

      let threw = false;
      try {
        // eslint-disable-next-line no-new
        new (window as any).UltraMediaCore(video);
      } catch {
        threw = true;
      }

      first.destroy();

      let reusedOk = true;
      try {
        const second = new (window as any).UltraMediaCore(video);
        second.load(fixture);
        await second.ready;
      } catch {
        reusedOk = false;
      }

      return { threw, reusedOk };
    }, { fixture: MP4_FIXTURE });

    expect(result).toEqual({ threw: true, reusedOk: true });
  });
});
