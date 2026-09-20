// @ts-nocheck
import { describe, it, expect, jest } from '@jest/globals';
import { VideoPlayer } from '../src/players/video-player';
import { HlsPlayer } from '../src/players/hls-player';

// Cycle 3: a discarded policy must leave *nothing* of itself behind - not a
// crossOrigin write on the native path, not a header from a previous retry
// attempt on the hls.js path - and a load without `credentials` must undo
// what an earlier load on the same player wrote.
describe('request policy: all-or-nothing per request', () => {
  it('native: when transformUrl() throws, credentials are not applied either', async () => {
    const element = document.createElement('video');
    element.load = jest.fn();
    const player = new VideoPlayer(element);
    const onError = jest.fn();
    player.onError(onError);

    player.load('https://example.com/a.mp4', {
      transformUrl: () => { throw new Error('boom'); },
      credentials: 'include',
    });

    expect(element.getAttribute('src')).toBe('https://example.com/a.mp4');
    expect(element.hasAttribute('crossorigin')).toBe(false);
    await Promise.resolve();
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ code: 'REQUEST_POLICY_ERROR' }));
  });

  it('native: a reused player undoes a prior credentials write when the next load has no credentials policy', () => {
    const element = document.createElement('video');
    element.load = jest.fn();
    const player = new VideoPlayer(element);
    player.load('https://example.com/a.mp4', { credentials: 'include' });
    expect(element.getAttribute('crossorigin')).toBe('use-credentials');
    player.load('https://example.com/b.mp4');
    expect(element.hasAttribute('crossorigin')).toBe(false);
  });

  it('native: a reused player restores the host value it found, not the previous policy value', () => {
    const element = document.createElement('video');
    element.setAttribute('crossorigin', 'anonymous');
    element.load = jest.fn();
    const player = new VideoPlayer(element);
    player.load('https://example.com/a.mp4', { credentials: 'include' });
    player.load('https://example.com/b.mp4', {});
    expect(element.getAttribute('crossorigin')).toBe('anonymous');
  });

  it('hls.js: a retry whose headers() throws goes out with the pristine headers, not the previous attempt\'s', async () => {
    let config: any;
    (window as any).Hls = jest.fn().mockImplementation((cfg: any) => {
      config = cfg;
      return { attachMedia: jest.fn(), on: jest.fn(), loadSource: jest.fn(), destroy: jest.fn() };
    });
    (window as any).Hls.Events = { ERROR: 'hlsError', MANIFEST_PARSED: 'hlsManifestParsed' };
    (window as any).Hls.isSupported = jest.fn().mockReturnValue(true);
    let calls = 0;
    const player = new HlsPlayer(document.createElement('video'), {
      transformUrl: (ctx) => ctx.url + '?sig=1',
      headers: () => {
        calls++;
        if (calls === 2) throw new Error('token expired');
        return { Authorization: 'Bearer old' };
      },
    });
    await player.onReady;
    const context: any = { url: 'https://example.com/master.m3u8', type: 'manifest' };
    const xhr = () => ({ open: jest.fn(), setRequestHeader: jest.fn(), withCredentials: false }) as unknown as XMLHttpRequest;
    const first = xhr();
    config.xhrSetup(first, context.url, context);
    expect(first.open).toHaveBeenCalledWith('GET', 'https://example.com/master.m3u8?sig=1', true);
    expect(context.headers).toEqual({ Authorization: 'Bearer old' });

    const second = xhr();
    config.xhrSetup(second, context.url, context);
    expect(second.open).toHaveBeenCalledWith('GET', 'https://example.com/master.m3u8', true);
    expect(context.url).toBe('https://example.com/master.m3u8');
    expect(context.headers).toBeUndefined();
    delete (window as any).Hls;
  });
});
