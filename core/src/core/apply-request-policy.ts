import type { MediaPlayerError } from './media-player';
import type { RequestContext, RequestPolicy } from './request-policy';

// The subset of a hls.js/dash.js request object `applyRequestPolicy` reads/writes.
export interface RequestPatch {
  url: string;
  headers?: Record<string, string>;
}

export type Report = (error: MediaPlayerError) => void;

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

// hls.js/dash.js path: mutates `req`. Returns false on a throw, after rolling `req`/`ctx` back (defect 4).
export function applyRequestPolicy(policy: RequestPolicy | undefined, ctx: RequestContext, req: RequestPatch, report: Report): boolean {
  if (!policy) return true;
  const originalUrl = req.url;
  const originalHeaders = req.headers;
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
    return true;
  } catch (cause) {
    req.url = originalUrl;
    req.headers = originalHeaders;
    ctx.url = originalUrl;
    report(policyError(ctx, cause));
    return false;
  }
}

// Defect 2 - crossOrigin is host-owned, restored on destroy() unless the host changed it since.
// [0] = backup (pre-existing value), [1] = applied (last value we wrote; null also means "never captured").
export type CrossOriginBackup = [backup: string | null, applied: string | null];

export function restoreCrossOrigin(element: HTMLMediaElement, state: CrossOriginBackup): void {
  const applied = state[1];
  if (applied === null) return;
  const backup = state[0];
  state[0] = state[1] = null;
  if (element.getAttribute('crossorigin') !== applied) return; // host changed it since - leave it
  if (backup === null) element.removeAttribute('crossorigin');
  else element.setAttribute('crossorigin', backup);
}

// Native playback: only URL/crossOrigin apply; `headers` warns. `report` fires synchronously - deferring is the caller's job (defect 3).
// All-or-nothing per load: if transformUrl() throws, nothing of the policy is applied (no credentials write either).
// A load without `credentials` undoes what an earlier load on the same element wrote (crossOrigin is host-owned).
export function applyNativeLoad(element: HTMLMediaElement, src: string, type: RequestContext['type'], engine: string, policy: RequestPolicy | undefined, report: Report, crossOriginState: CrossOriginBackup): string {
  let url = src;
  let policyOk = !!policy;
  if (policy) {
    const ctx: RequestContext = { url: src, type, engine };
    if (policy.transformUrl) {
      try {
        url = policy.transformUrl(ctx) || src;
      } catch (cause) {
        policyOk = false;
        report(policyError(ctx, cause));
      }
    }
    if (policyOk && policy.headers) {
      ctx.url = url;
      reportHeadersUnsupported(ctx, report);
    }
  }
  if (policyOk && policy!.credentials) {
    if (crossOriginState[1] === null) crossOriginState[0] = element.getAttribute('crossorigin');
    element.crossOrigin = policy!.credentials === 'include' ? 'use-credentials' : 'anonymous';
    crossOriginState[1] = element.getAttribute('crossorigin');
  } else {
    restoreCrossOrigin(element, crossOriginState);
  }
  return url;
}

// Synchronous; also used directly by YouTubePlayer.
export function reportHeadersUnsupported(ctx: RequestContext, report: Report): void {
  report({
    fatal: false,
    category: 'otherError',
    code: 'REQUEST_HEADERS_UNSUPPORTED',
    message: ctx.engine + ' cannot set custom request headers for this source - the browser/SDK issues it without a header hook.',
    engine: ctx.engine,
    url: ctx.url,
  });
}

// Defect 3 - defers so wireUp() runs first, then drops the report if `isCurrent()` says a later load()/destroy() superseded it.
export function deferredGuardedReport(report: Report, isCurrent: () => boolean): Report {
  return (error) => {
    Promise.resolve().then(() => isCurrent() && report(error));
  };
}
