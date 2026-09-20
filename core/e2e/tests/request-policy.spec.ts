import type { Page, Request } from '@playwright/test';
import { test, expect } from '../utils/hermetic';
import { gotoPlayer, setSrc, getLog, instrument, callMethod, getProp } from '../utils/media';

// ADR-0001 D4 - real network proof: `options.request` applied via
// `<ultra-media>`'s `request` property (no HTML attribute - headers with
// tokens don't belong in markup), captured with `page.route` against the
// hermetic fixture server (never a real CDN, per e2e/utils/hermetic.ts).
const HLS_FIXTURE = '/fixtures/hls/master.m3u8';
const DASH_FIXTURE = '/fixtures/dash/manifest.mpd';
const MP4_FIXTURE = '/fixtures/mp4/sample.mp4';

async function setRequestPolicy(page: Page, policy: unknown): Promise<void> {
  await page.evaluate((policy) => {
    (document.querySelector('#player') as any).request = policy;
  }, policy);
}

function captureRequests(page: Page, pathPattern: RegExp): Request[] {
  const seen: Request[] = [];
  page.on('request', (req) => {
    if (pathPattern.test(new URL(req.url()).pathname + new URL(req.url()).search)) seen.push(req);
  });
  return seen;
}

test.describe('request policy: headers (ADR-0001 D4)', () => {
  test('hls: 100% of manifest+segment requests carry the Authorization header', async ({ page }) => {
    const requests = captureRequests(page, /\/fixtures\/hls\//);
    await gotoPlayer(page);
    await instrument(page);
    await setRequestPolicy(page, { headers: { Authorization: 'Bearer t' } });
    await setSrc(page, HLS_FIXTURE);

    await expect.poll(async () => (await getLog(page)).some((e) => e.name === 'loadedmetadata')).toBe(true);
    await callMethod(page, 'play');
    await expect.poll(async () => (await getProp(page, 'currentTime')) as number, { timeout: 10_000 }).toBeGreaterThan(1);

    expect(requests.length).toBeGreaterThan(0);
    const withHeader = requests.filter((r) => r.headers()['authorization'] === 'Bearer t');
    expect(withHeader).toHaveLength(requests.length);
  });

  test('dash: 100% of manifest+segment requests carry the Authorization header', async ({ page }) => {
    const requests = captureRequests(page, /\/fixtures\/dash\//);
    await gotoPlayer(page);
    await instrument(page);
    await setRequestPolicy(page, { headers: { Authorization: 'Bearer t' } });
    await setSrc(page, DASH_FIXTURE);

    await expect.poll(async () => (await getLog(page)).some((e) => e.name === 'loadedmetadata')).toBe(true);
    await callMethod(page, 'play');
    await expect.poll(async () => (await getProp(page, 'currentTime')) as number, { timeout: 10_000 }).toBeGreaterThan(1);

    expect(requests.length).toBeGreaterThan(0);
    const withHeader = requests.filter((r) => r.headers()['authorization'] === 'Bearer t');
    expect(withHeader).toHaveLength(requests.length);
  });

  // (no key fixture exists - e2e/fixtures/generate.mjs doesn't produce an
  // encrypted HLS stream, so the `key` RequestContext.type is unit-tested
  // only, via hls-player.test.ts's classification test. Registered here so
  // the gap is visible, not silently assumed away.)

  test('mp4 (native): headers are impossible - REQUEST_HEADERS_UNSUPPORTED warns once and the video still plays', async ({ page }) => {
    await gotoPlayer(page);
    await instrument(page);
    await setRequestPolicy(page, { headers: { Authorization: 'Bearer t' } });
    await setSrc(page, MP4_FIXTURE);

    await expect.poll(async () => (await getLog(page)).some((e) => e.name === 'warning')).toBe(true);
    const warnings = (await getLog(page)).filter((e) => e.name === 'warning');
    expect(warnings).toHaveLength(1);
    expect(warnings[0].detail).toMatchObject({ fatal: false, code: 'REQUEST_HEADERS_UNSUPPORTED', engine: 'video/mp4' });

    await callMethod(page, 'play');
    await expect.poll(async () => (await getProp(page, 'currentTime')) as number, { timeout: 10_000 }).toBeGreaterThan(1);
    expect((await getLog(page)).some((e) => e.name === 'error')).toBe(false);
  });
});

test.describe('request policy: transformUrl (ADR-0001 D4)', () => {
  test('hls: every request carries the ?sig=1 query param transformUrl adds', async ({ page }) => {
    const requests = captureRequests(page, /\/fixtures\/hls\//);
    await gotoPlayer(page);
    await instrument(page);
    await page.evaluate(() => {
      (document.querySelector('#player') as any).request = {
        transformUrl: (ctx: { url: string }) => ctx.url + (ctx.url.includes('?') ? '&' : '?') + 'sig=1',
      };
    });
    await setSrc(page, HLS_FIXTURE);

    await expect.poll(async () => (await getLog(page)).some((e) => e.name === 'loadedmetadata')).toBe(true);
    await callMethod(page, 'play');
    await expect.poll(async () => (await getProp(page, 'currentTime')) as number, { timeout: 10_000 }).toBeGreaterThan(1);

    expect(requests.length).toBeGreaterThan(0);
    const signed = requests.filter((r) => new URL(r.url()).searchParams.get('sig') === '1');
    expect(signed).toHaveLength(requests.length);
  });
});

test.describe('request policy: credentials (ADR-0001 D4)', () => {
  // XHR only exposes `withCredentials` in-page, not on the wire in a way
  // page.route can distinguish for a same-origin request (same-origin XHRs
  // already carry cookies regardless of the flag - only cross-origin
  // behavior differs, which this hermetic single-origin fixture server
  // can't exercise). Spying on the real XHR instances hls.js creates proves
  // the policy actually reaches them, which is what our code is responsible
  // for - see README.md's "Authentication & request policy" for the
  // same-origin-only caveat this documents.
  test('hls: credentials:"include" sets xhr.withCredentials on every request', async ({ page }) => {
    await gotoPlayer(page);
    await page.evaluate(() => {
      const seen: boolean[] = [];
      (window as any).__withCredentials = seen;
      const OriginalXhr = window.XMLHttpRequest;
      const send = OriginalXhr.prototype.send;
      OriginalXhr.prototype.send = function (this: XMLHttpRequest, ...args: unknown[]) {
        seen.push(this.withCredentials);
        return send.apply(this, args as []);
      };
    });
    await instrument(page);
    await setRequestPolicy(page, { credentials: 'include' });
    await setSrc(page, HLS_FIXTURE);

    await expect.poll(async () => (await getLog(page)).some((e) => e.name === 'loadedmetadata')).toBe(true);
    await callMethod(page, 'play');
    await expect.poll(async () => (await getProp(page, 'currentTime')) as number, { timeout: 10_000 }).toBeGreaterThan(1);

    const seen = await page.evaluate(() => (window as any).__withCredentials as boolean[]);
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.every(Boolean)).toBe(true);
  });
});

test.describe('request policy: configure() only affects the next load() (ADR-0001 D4)', () => {
  test('switching the header via the request property between two loads changes the second, not the first', async ({ page }) => {
    const requests = captureRequests(page, /\/fixtures\/hls\//);
    await gotoPlayer(page);
    await instrument(page);

    await setSrc(page, HLS_FIXTURE);
    await expect.poll(async () => (await getLog(page)).some((e) => e.name === 'loadedmetadata')).toBe(true);
    const firstLoadRequestCount = requests.length;
    expect(firstLoadRequestCount).toBeGreaterThan(0);
    expect(requests.every((r) => r.headers()['authorization'] === undefined)).toBe(true);

    await setRequestPolicy(page, { headers: { Authorization: 'Bearer new' } });
    // A distinct (but equivalent) src, not the exact same string - the shell
    // treats re-setting the identical `src` attribute value on an element
    // that already has an active player for it as a no-op by design (see
    // ultra-media-element.ts's attributeChangedCallback); this still resolves
    // to the same fixture file and format (same hls.js instance reused).
    await setSrc(page, HLS_FIXTURE + '?reload=1');

    await expect.poll(async () => requests.length > firstLoadRequestCount, { timeout: 10_000 }).toBe(true);
    await callMethod(page, 'play');
    await expect.poll(async () => (await getProp(page, 'currentTime')) as number, { timeout: 10_000 }).toBeGreaterThan(1);

    // Requests captured before the reconfigure stay header-less; every
    // request captured from the second load() onward carries it.
    const beforeReconfigure = requests.slice(0, firstLoadRequestCount);
    const fromSecondLoad = requests.slice(firstLoadRequestCount);
    expect(beforeReconfigure.every((r) => r.headers()['authorization'] === undefined)).toBe(true);
    expect(fromSecondLoad.length).toBeGreaterThan(0);
    expect(fromSecondLoad.every((r) => r.headers()['authorization'] === 'Bearer new')).toBe(true);
  });
});
