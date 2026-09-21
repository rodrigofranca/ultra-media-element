import type { Page } from '@playwright/test';

export const SELECTOR = '#player';

const INSTRUMENTED_EVENTS = [
  'loadedmetadata',
  'play',
  'playing',
  'pause',
  'seeked',
  'timeupdate',
  'error',
  'warning',
  'emptied',
  'abort',
  'loadstart',
  'suspend',
  'stalled',
  'canplay',
  'livechange',
  'streamended',
] as const;

/** Navigates to the harness page hosting a bare <ultra-media> element. */
export async function gotoPlayer(page: Page): Promise<void> {
  await page.goto('/player.html');
  await page.waitForFunction(() => customElements.get('ultra-media') !== undefined);
}

/**
 * Forces the teardown/reload race window open via CDP instead of relying on
 * ambient host load - deterministic on a fast, idle machine, unlike hoping a
 * shared CI/dev box happens to be slow enough when a run lands (see
 * result-cycle3.md's diagnosis: ambient load could not be used as the
 * reproduction signal, it never correlated with the specific defect under
 * test). `rate` follows CDP's `Emulation.setCPUThrottlingRate` (1 = no
 * throttling; 10 = the renderer runs as if on a CPU 10x slower).
 */
export async function throttleCpu(page: Page, rate: number): Promise<void> {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate });
}

/**
 * Attaches listeners for every event a spec might assert on, all inside one
 * evaluate() call so nothing can fire between "attach listener" and
 * "read log" round-trips.
 */
export async function instrument(page: Page, selector = SELECTOR): Promise<void> {
  await page.evaluate(
    ({ selector, events }) => {
      const el = document.querySelector(selector) as HTMLVideoElement;
      const w = window as unknown as {
        __log: Array<{
          name: string;
          currentTime: number;
          detail: unknown;
          t: number;
          src: string;
          currentSrc: string;
          networkState: number;
          readyState: number;
        }>;
        __t0: number;
      };
      w.__log = [];
      w.__t0 = performance.now();
      for (const name of events) {
        el.addEventListener(name, (e) => {
          w.__log.push({
            name,
            currentTime: el.currentTime,
            detail: (e as CustomEvent).detail ?? null,
            t: Math.round(performance.now() - w.__t0),
            src: el.src,
            currentSrc: el.currentSrc,
            networkState: el.networkState,
            readyState: el.readyState,
          });
        });
      }
    },
    { selector, events: INSTRUMENTED_EVENTS }
  );
}

export type LogEntry = {
  name: string;
  currentTime: number;
  detail: unknown;
  t: number;
  src: string;
  currentSrc: string;
  networkState: number;
  readyState: number;
};

/** Snapshot of native <video> state - for dumping "what the test saw when it gave up" on a diagnostic timeout. */
export function getNativeState(page: Page, selector = SELECTOR): Promise<{
  src: string;
  currentSrc: string;
  networkState: number;
  readyState: number;
  currentTime: number;
}> {
  return page.evaluate((selector) => {
    const el = document.querySelector(selector) as HTMLVideoElement;
    return {
      src: el.src,
      currentSrc: el.currentSrc,
      networkState: el.networkState,
      readyState: el.readyState,
      currentTime: el.currentTime,
    };
  }, selector);
}

export function getLog(page: Page): Promise<LogEntry[]> {
  return page.evaluate(() => (window as unknown as { __log: LogEntry[] }).__log ?? []);
}

/** Clears the event log without detaching the listeners instrument() attached. */
export function resetLog(page: Page): Promise<void> {
  return page.evaluate(() => {
    const w = window as unknown as { __log: LogEntry[]; __t0: number };
    w.__log = [];
    w.__t0 = performance.now();
  });
}

export async function setSrc(page: Page, src: string, selector = SELECTOR): Promise<void> {
  await page.evaluate(
    ({ selector, src }) => document.querySelector(selector)!.setAttribute('src', src),
    { selector, src }
  );
}

export function getProp(page: Page, prop: string, selector = SELECTOR): Promise<unknown> {
  return page.evaluate(
    ({ selector, prop }) => (document.querySelector(selector) as unknown as Record<string, unknown>)[prop],
    { selector, prop }
  );
}

export async function callMethod(page: Page, method: string, args: unknown[] = [], selector = SELECTOR): Promise<unknown> {
  return page.evaluate(
    ({ selector, method, args }) => {
      const el = document.querySelector(selector) as unknown as Record<string, (...a: unknown[]) => unknown>;
      return el[method](...args);
    },
    { selector, method, args }
  );
}

export function videoRenditions(page: Page, selector = SELECTOR): Promise<Array<{ width: number; height: number }>> {
  return page.evaluate((selector) => {
    const el = document.querySelector(selector) as unknown as {
      videoRenditions: Iterable<{ width: number; height: number }>;
    };
    return [...el.videoRenditions].map((r) => ({ width: r.width, height: r.height }));
  }, selector);
}

export function audioTracks(page: Page, selector = SELECTOR): Promise<Array<{ id: string; language: string }>> {
  return page.evaluate((selector) => {
    const el = document.querySelector(selector) as unknown as {
      audioTracks: Iterable<{ id: string; language: string }>;
    };
    return [...el.audioTracks].map((t) => ({ id: t.id, language: t.language }));
  }, selector);
}
