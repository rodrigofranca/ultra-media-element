import { describe, it, expect, jest } from '@jest/globals';
import {
  applyRequestPolicy,
  applyNativeLoad,
  restoreCrossOrigin,
  deferredGuardedReport,
  type RequestPatch,
  type CrossOriginBackup,
} from '../src/core/apply-request-policy';
import type { RequestContext } from '../src/core/request-policy';
import type { MediaPlayerError } from '../src/core/media-player';

function ctx(url: string): RequestContext {
  return { url, type: 'segment', engine: 'test' };
}

function newCrossOriginBackup(): CrossOriginBackup {
  return [null, null];
}

describe('applyRequestPolicy (ADR-0001 D4)', () => {
  it('returns true and applies transformUrl + headers when no callback throws', () => {
    const report = jest.fn();
    const req: RequestPatch = { url: 'https://example.com/a' };
    const c = ctx('https://example.com/a');

    const ok = applyRequestPolicy({ transformUrl: (c) => c.url + '?sig=1', headers: { A: '1' } }, c, req, report);

    expect(ok).toBe(true);
    expect(req.url).toBe('https://example.com/a?sig=1');
    expect(req.headers).toEqual({ A: '1' });
    expect(report).not.toHaveBeenCalled();
  });

  // result-cycle2.md defect 4 - a headers() throw after a successful
  // transformUrl() must not leave the request half-policied.
  it('rolls back url AND headers to their original values when headers() throws after transformUrl() succeeded', () => {
    const report = jest.fn();
    const req: RequestPatch = { url: 'https://example.com/a', headers: { Existing: '1' } };
    const c = ctx('https://example.com/a');

    const ok = applyRequestPolicy(
      { transformUrl: (c) => c.url + '?sig=1', headers: () => { throw new Error('boom'); } },
      c,
      req,
      report,
    );

    expect(ok).toBe(false);
    expect(req.url).toBe('https://example.com/a');
    expect(req.headers).toEqual({ Existing: '1' });
    expect(c.url).toBe('https://example.com/a');
    expect(report).toHaveBeenCalledWith(expect.objectContaining({ code: 'REQUEST_POLICY_ERROR' }));
  });

  it('rolls back to the original url when transformUrl() itself throws', () => {
    const report = jest.fn();
    const req: RequestPatch = { url: 'https://example.com/a' };
    const c = ctx('https://example.com/a');

    const ok = applyRequestPolicy({ transformUrl: () => { throw new Error('boom'); } }, c, req, report);

    expect(ok).toBe(false);
    expect(req.url).toBe('https://example.com/a');
  });

  it('is a no-op returning true when no policy is given', () => {
    const req: RequestPatch = { url: 'https://example.com/a' };
    expect(applyRequestPolicy(undefined, ctx('https://example.com/a'), req, jest.fn())).toBe(true);
    expect(req.url).toBe('https://example.com/a');
  });
});

describe('crossOrigin backup/restore (result-cycle2.md defect 2)', () => {
  it('captures the pre-existing value once and restores it on the first restore call', () => {
    const element = document.createElement('video');
    element.setAttribute('crossorigin', 'anonymous');
    const state = newCrossOriginBackup();

    applyNativeLoad(element, 'https://example.com/a.mp4', 'other', 'video/mp4', { credentials: 'include' }, jest.fn(), state);
    expect(element.crossOrigin).toBe('use-credentials');

    restoreCrossOrigin(element, state);

    expect(element.getAttribute('crossorigin')).toBe('anonymous');
  });

  it('removes the attribute entirely when it was absent before the first write', () => {
    const element = document.createElement('video');
    const state = newCrossOriginBackup();

    applyNativeLoad(element, 'https://example.com/a.mp4', 'other', 'video/mp4', { credentials: 'include' }, jest.fn(), state);
    restoreCrossOrigin(element, state);

    expect(element.hasAttribute('crossorigin')).toBe(false);
  });

  it('never re-captures the backup across repeated writes on the same state', () => {
    const element = document.createElement('video');
    const state = newCrossOriginBackup();

    applyNativeLoad(element, 'https://example.com/a.mp4', 'other', 'video/mp4', { credentials: 'include' }, jest.fn(), state);
    applyNativeLoad(element, 'https://example.com/b.mp4', 'other', 'video/mp4', { credentials: 'omit' }, jest.fn(), state);
    expect(element.crossOrigin).toBe('anonymous');

    restoreCrossOrigin(element, state);

    expect(element.hasAttribute('crossorigin')).toBe(false);
  });

  it('leaves a host-made change alone if it no longer matches what we last wrote', () => {
    const element = document.createElement('video');
    const state = newCrossOriginBackup();

    applyNativeLoad(element, 'https://example.com/a.mp4', 'other', 'video/mp4', { credentials: 'include' }, jest.fn(), state);
    element.setAttribute('crossorigin', 'anonymous'); // host override after our write

    restoreCrossOrigin(element, state);

    expect(element.getAttribute('crossorigin')).toBe('anonymous');
  });

  it('restoreCrossOrigin is a no-op when nothing was ever captured', () => {
    const element = document.createElement('video');
    const state = newCrossOriginBackup();
    expect(() => restoreCrossOrigin(element, state)).not.toThrow();
    expect(element.hasAttribute('crossorigin')).toBe(false);
  });
});

describe('deferredGuardedReport (result-cycle2.md defect 3)', () => {
  it('defers the report to a microtask', async () => {
    const inner = jest.fn<(e: MediaPlayerError) => void>();
    const guarded = deferredGuardedReport(inner, () => true);

    guarded({ fatal: false, category: 'otherError', code: 'X', message: '', engine: 'test' });
    expect(inner).not.toHaveBeenCalled();

    await Promise.resolve();
    expect(inner).toHaveBeenCalledTimes(1);
  });

  it('drops the report when isCurrent() is false by the time the microtask runs', async () => {
    const inner = jest.fn<(e: MediaPlayerError) => void>();
    let current = true;
    const guarded = deferredGuardedReport(inner, () => current);

    guarded({ fatal: false, category: 'otherError', code: 'X', message: '', engine: 'test' });
    current = false; // e.g. a later load()/destroy() superseded this report before it fired

    await Promise.resolve();
    expect(inner).not.toHaveBeenCalled();
  });
});
