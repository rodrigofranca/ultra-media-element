import type { MediaPlayerError } from './media-player';
import type { RequestContext, RequestPolicy } from './request-policy';

/** The subset of a hls.js/dash.js request object `applyRequestPolicy` reads/writes. */
export interface RequestPatch {
  url: string;
  headers?: Record<string, string>;
}

type Report = (error: MediaPlayerError) => void;

function policyError(ctx: RequestContext, cause: unknown): MediaPlayerError {
  return {
    fatal: false,
    category: 'otherError',
    code: 'REQUEST_POLICY_ERROR',
    message: 'options.request threw - continuing without it for this request.',
    engine: ctx.engine,
    url: ctx.url,
    cause,
  };
}

/**
 * hls.js/dash.js path (ADR-0001 D4): both support `transformUrl` and
 * `headers` per request, so this mutates `req` (a plain `{url, headers}`
 * view onto the SDK's own request object) in place. Order matters -
 * `transformUrl` runs first, so a host `headers(ctx)` sees the final URL.
 * A throw from either host callback is caught and reported as a
 * `REQUEST_POLICY_ERROR` warning instead of failing the request outright.
 */
export function applyRequestPolicy(policy: RequestPolicy | undefined, ctx: RequestContext, req: RequestPatch, report: Report): void {
  if (!policy) return;
  try {
    if (policy.transformUrl) {
      const url = policy.transformUrl(ctx);
      if (url) {
        req.url = url;
        ctx.url = url;
      }
    }
    if (policy.headers) {
      const resolved = typeof policy.headers === 'function' ? policy.headers(ctx) : policy.headers;
      if (resolved) req.headers = { ...req.headers, ...resolved };
    }
  } catch (cause) {
    report(policyError(ctx, cause));
  }
}

/**
 * Native playback (video/mp4, audio/mp3, HLS-without-MSE fallback): the
 * browser fetches `element.src` itself, so only the one top-level URL
 * (transformUrl) and `crossOrigin` (credentials) can apply - `headers` is
 * impossible and gets a warning instead of being silently dropped
 * (ADR-0001 D4). Shared by VideoPlayer/AudioPlayer/HlsPlayer's fallback
 * branch - the only difference between them is `element`/`type`/`engine`.
 */
export function applyNativeLoad(element: HTMLMediaElement, src: string, type: RequestContext['type'], engine: string, policy: RequestPolicy | undefined, report: Report): string {
  let url = src;
  if (policy) {
    const ctx: RequestContext = { url: src, type, engine };
    if (policy.transformUrl) {
      try {
        url = policy.transformUrl(ctx) || src;
      } catch (cause) {
        report(policyError(ctx, cause));
      }
    }
    if (policy.credentials) element.crossOrigin = policy.credentials === 'include' ? 'use-credentials' : 'anonymous';
    if (policy.headers) {
      ctx.url = url;
      reportHeadersUnsupported(ctx, report);
    }
  }
  return url;
}

/**
 * Deferred to a microtask (`Promise.resolve().then()`, not `queueMicrotask`
 * - ES2017 Smart TV target, see player-factory.ts's containerRequiredPlayer
 * for the same pattern): PlayerFactory.create() calls `player.load()`
 * synchronously, before UltraMediaCore.wireUp() (re)registers this load's
 * onError callback - by the time this runs, wireUp() has already run within
 * the same synchronous call stack, for both a brand new player and a reused
 * one (ADR-0001 D4).
 */
export function reportHeadersUnsupported(ctx: RequestContext, report: Report): void {
  Promise.resolve().then(() => report({
    fatal: false,
    category: 'otherError',
    code: 'REQUEST_HEADERS_UNSUPPORTED',
    message: ctx.engine + ' cannot set custom request headers for this source - the browser/SDK issues it without a header hook.',
    engine: ctx.engine,
    url: ctx.url,
  }));
}
