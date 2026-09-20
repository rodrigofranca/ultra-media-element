import type { Page } from '@playwright/test';
import { test, expect } from '../utils/hermetic';
import { getLog, getProp, instrument, resetLog, setSrc } from '../utils/media';
import fixtureManifest from '../fixtures/manifest.json' with { type: 'json' };

// ADR-0001 D3's e2e gate: <ultra-media> plugged into a real <media-controller>
// (media-chrome, served locally from node_modules - see
// e2e/server/static-server.mjs's /media-chrome/ route, hermetic like every
// other spec here) instead of the bare #player harness every other spec
// here uses. Every interaction below drives the *real* media-chrome custom
// elements (button clicks, a native <input type=range> fill), never
// ultra-media's own API directly - that's the whole point of this gate.
//
// One test per engine bundles play/mute/seek/duration/swap together
// (instead of a page load each) - this suite is heavier than the rest
// (media-chrome's own custom elements, a real <media-controller>, hls.js)
// and was observed to push the default e2e parallelism (11 workers) into
// real CPU contention (page-fixture setup itself exceeding the default
// timeout) - same class of environment sensitivity errors.spec.ts/
// pending-load-cancel.spec.ts already document for other heavy specs, at a
// scale that also needed fewer concurrent page loads, not just a longer
// timeout - see result.md "Descobertas".
const SELECTOR = '#player';
const MP4_FIXTURE = '/fixtures/mp4/sample.mp4';
const HLS_FIXTURE = '/fixtures/hls/master.m3u8';
const EXPECTED_DURATION = fixtureManifest.duration;

async function gotoMediaChromePlayer(page: Page): Promise<void> {
  await page.goto('/media-chrome-player.html');
  await page.waitForFunction(() => customElements.get('media-controller') !== undefined);
  await page.waitForFunction(() => customElements.get('media-rendition-menu') !== undefined);
}

async function isPaused(page: Page): Promise<boolean> {
  return getProp(page, 'paused', SELECTOR) as Promise<boolean>;
}

const CASES = [
  { engine: 'mp4', fixture: MP4_FIXTURE },
  { engine: 'hls', fixture: HLS_FIXTURE },
];

test.describe('media-chrome gate (ADR-0001 D3)', () => {
  test.describe.configure({ timeout: 60_000 });

  for (const { engine, fixture } of CASES) {
    test(`play/mute/seek/duration through real media-chrome controls (${engine})`, async ({ page }) => {
      await gotoMediaChromePlayer(page);
      await instrument(page);
      await setSrc(page, fixture, SELECTOR);
      await expect.poll(async () => (await getLog(page)).some((e) => e.name === 'loadedmetadata'), { timeout: 10_000 }).toBe(true);

      // Duration: media-time-range is a media-chrome "state receiver" -
      // it carries the controller's current duration as its own attribute.
      await expect.poll(async () => {
        const attr = await page.locator('media-time-range').getAttribute('mediaduration');
        return attr ? Number(attr) : null;
      }, { timeout: 10_000 }).toBeCloseTo(EXPECTED_DURATION, 0);

      // Play: media-play-button is also a state receiver (mediapaused) -
      // independent proof, alongside the <video> itself, that the whole
      // media-chrome <-> ultra-media wiring (not just our own API) works.
      const playButton = page.locator('media-play-button');
      await expect(playButton).toHaveAttribute('mediapaused', '');
      expect(await isPaused(page)).toBe(true);

      await playButton.click();

      await expect(playButton).not.toHaveAttribute('mediapaused', '');
      await expect.poll(async () => isPaused(page), { timeout: 10_000 }).toBe(false);
      await expect.poll(async () => (await getProp(page, 'currentTime', SELECTOR)) as number, { timeout: 10_000 }).toBeGreaterThan(0.2);

      await playButton.click();
      await expect.poll(async () => isPaused(page)).toBe(true);
      expect((await getLog(page)).map((e) => e.name)).not.toContain('error');

      // Mute: toggles the real element property.
      expect(await getProp(page, 'muted', SELECTOR)).toBe(false);
      await page.locator('media-mute-button').click();
      await expect.poll(async () => getProp(page, 'muted', SELECTOR)).toBe(true);
      await page.locator('media-mute-button').click();
      await expect.poll(async () => getProp(page, 'muted', SELECTOR)).toBe(false);

      // Seek: the real native <input type="range"> inside media-time-
      // range's open shadow root (Playwright pierces open shadow roots
      // with a plain CSS selector) - .fill() sets its value and fires a
      // real `input` event, which media-time-range turns into a
      // MEDIA_SEEK_REQUEST the controller forwards to the element's own
      // currentTime setter. Driving it "via valor" (brief's alternative to
      // keyboard) - deterministic, no dependency on the range's internal
      // step/keyboard granularity.
      const range = page.locator('media-time-range input[type="range"]');
      await range.fill('0.6');
      await expect.poll(async () => (await getProp(page, 'currentTime', SELECTOR)) as number, { timeout: 10_000 })
        .toBeGreaterThan(EXPECTED_DURATION * 0.4);

      await page.evaluate((selector) => document.querySelector(selector)!.remove(), SELECTOR);
    });

    test(`swapping src with the controller mounted keeps controls working, and removal leaves no console errors (${engine})`, async ({ page }) => {
      const other = engine === 'mp4' ? HLS_FIXTURE : MP4_FIXTURE;
      await gotoMediaChromePlayer(page);
      await instrument(page);
      await setSrc(page, fixture, SELECTOR);
      await expect.poll(async () => (await getLog(page)).some((e) => e.name === 'loadedmetadata'), { timeout: 10_000 }).toBe(true);

      await resetLog(page);
      await setSrc(page, other, SELECTOR);
      await expect.poll(async () => (await getLog(page)).some((e) => e.name === 'loadedmetadata'), { timeout: 10_000 }).toBe(true);

      const playButton = page.locator('media-play-button');
      await playButton.click();
      await expect.poll(async () => isPaused(page), { timeout: 10_000 }).toBe(false);
      await expect.poll(async () => (await getProp(page, 'currentTime', SELECTOR)) as number, { timeout: 10_000 }).toBeGreaterThan(0.2);
      expect((await getLog(page)).map((e) => e.name)).not.toContain('error');

      // pageErrors (hermetic.ts, auto fixture) asserts no unhandled
      // exception at test end - removing the element here, with the
      // controller still mounted, gives it something real to observe.
      await page.evaluate((selector) => document.querySelector(selector)!.remove(), SELECTOR);
      await new Promise((resolve) => setTimeout(resolve, 300));
    });
  }

  test('rendition menu lists the 2 fixture renditions; selecting one switches the core, "auto" is a documented no-propagate no-op (hls only)', async ({ page }) => {
    test.setTimeout(60_000);
    await gotoMediaChromePlayer(page);
    await setSrc(page, HLS_FIXTURE, SELECTOR);
    await expect.poll(async () => page.evaluate(
      (selector) => (document.querySelector(selector) as any).videoRenditions.length, SELECTOR
    ), { timeout: 10_000 }).toBe(fixtureManifest.hls.renditions.length);

    // media-rendition-menu builds its items reactively off the element's
    // videoRenditions - open it via its button (invoketarget wiring, see
    // e2e/pages/media-chrome-player.html) so the items actually render
    // before reading them.
    await page.locator('media-rendition-menu-button').click();
    const menu = page.locator('media-rendition-menu');
    await expect.poll(async () => menu.evaluate((el: any) => el.items?.length ?? 0)).toBeGreaterThanOrEqual(
      fixtureManifest.hls.renditions.length
    );

    const ids: string[] = await page.evaluate((selector) => {
      const el = document.querySelector(selector) as any;
      return [...el.videoRenditions].map((r: any) => r.id);
    }, SELECTOR);
    expect(ids).toHaveLength(fixtureManifest.hls.renditions.length);
    const targetId = ids[ids.length - 1]; // the lower-res rendition, deterministically last per hls-player.ts's index-based ids

    // Setting .value on the menu is what a real item click does internally
    // (MediaChromeMenu#value's setter finds the matching item and
    // dispatches the same mediarenditionrequest a click would) - media-
    // controller's state mediator then sets media.videoRenditions.
    // selectedIndex, which is what ultra-media's own videoRenditions.
    // onchange listens for (src/ultra-media-element.ts#setupTrackListeners)
    // to call core.rendition = id.
    await menu.evaluate((el: any, id: string) => { el.value = id; }, targetId);

    await expect.poll(async () => page.evaluate((selector) => {
      const el = document.querySelector(selector) as any;
      return el.videoRenditions.selectedIndex;
    }, SELECTOR)).toBe(ids.indexOf(targetId));

    await expect.poll(async () => page.evaluate((selector) => (document.querySelector(selector) as any).core?.rendition, SELECTOR))
      .toBe(targetId);

    // Descoberta (see result.md): selecting "auto" resets
    // videoRenditions.selectedIndex to -1 (media-chrome's state mediator
    // can't find a rendition with id "auto"), but ultra-media-element.ts's
    // own onchange handler only calls core.rendition when some rendition
    // reports .selected === true - with none selected, it never fires, so
    // core.rendition is simply never reset to 'auto' through this control.
    // core.rendition setting 'auto' is itself already a no-op on the
    // engine (UltraMediaCore#rendition setter, `if (id !== 'auto')
    // this.player?.switchRendition?.(id)`) - so the *combination* observed
    // here is "auto" not even reaching the core, on top of the core's own
    // no-op. Out of scope to change (would touch the core / add shell
    // behavior not asked for) - documented, not fixed.
    await menu.evaluate((el: any) => { el.value = 'auto'; });

    await expect.poll(async () => page.evaluate((selector) => {
      const el = document.querySelector(selector) as any;
      return el.videoRenditions.selectedIndex;
    }, SELECTOR)).toBe(-1);

    expect(await page.evaluate((selector) => (document.querySelector(selector) as any).core?.rendition, SELECTOR)).toBe(targetId);

    await page.evaluate((selector) => document.querySelector(selector)!.remove(), SELECTOR);
  });
});
