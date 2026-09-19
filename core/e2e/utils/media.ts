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
  'emptied',
] as const;

/** Navigates to the harness page hosting a bare <ultra-media> element. */
export async function gotoPlayer(page: Page): Promise<void> {
  await page.goto('/player.html');
  await page.waitForFunction(() => customElements.get('ultra-media') !== undefined);
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
      const w = window as unknown as { __log: Array<{ name: string; currentTime: number; detail: unknown }> };
      w.__log = [];
      for (const name of events) {
        el.addEventListener(name, (e) => {
          w.__log.push({
            name,
            currentTime: el.currentTime,
            detail: (e as CustomEvent).detail ?? null,
          });
        });
      }
    },
    { selector, events: INSTRUMENTED_EVENTS }
  );
}

export type LogEntry = { name: string; currentTime: number; detail: unknown };

export function getLog(page: Page): Promise<LogEntry[]> {
  return page.evaluate(() => (window as unknown as { __log: LogEntry[] }).__log ?? []);
}

/** Clears the event log without detaching the listeners instrument() attached. */
export function resetLog(page: Page): Promise<void> {
  return page.evaluate(() => {
    (window as unknown as { __log: LogEntry[] }).__log = [];
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
