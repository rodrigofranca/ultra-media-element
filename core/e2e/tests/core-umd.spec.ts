import { test, expect } from '../utils/hermetic';
import fixtureManifest from '../fixtures/manifest.json' with { type: 'json' };

// cycle 3, defect 5: the UMD entry was previously only proven two ways -
// tests/require-entries.test.ts's Node require() (a CJS consumer) and
// core-only.html's ESM <script type="module"> import. Neither exercises the
// actual "drop dist/ultra-media-core.umd.cjs into a plain, non-module
// <script src> tag" path a browser-global consumer (e.g. an ad kernel with
// no bundler) would use.
const MP4_FIXTURE = '/fixtures/mp4/sample.mp4';

test.describe('UltraMediaCore UMD global via a plain <script src> tag (cycle 3, defect 5)', () => {
  test('window["ultra-media-core"].UltraMediaCore is a function and plays mp4', async ({ page }) => {
    await page.goto('/core-umd.html');
    await page.waitForFunction(() => (window as any)['ultra-media-core']?.UltraMediaCore !== undefined);

    const result = await page.evaluate(async ({ fixture }) => {
      const UltraMediaCore = (window as any)['ultra-media-core'].UltraMediaCore;
      const video = document.querySelector('#video') as HTMLVideoElement;
      const core = new UltraMediaCore(video);
      core.load(fixture);
      await core.ready;
      await video.play();
      await new Promise((r) => setTimeout(r, 300));
      return { duration: video.duration, currentTime: video.currentTime, engine: core.engine };
    }, { fixture: MP4_FIXTURE });

    expect(typeof result).toBe('object');
    expect(result.duration).toBeCloseTo(fixtureManifest.duration, 0);
    expect(result.currentTime).toBeGreaterThan(0);
    expect(result.engine).toBe('video/mp4');
  });
});
