import { describe, it, expect, jest } from '@jest/globals';
import { watchNativeLive, goToLiveViaSeekable } from '../src/core/native-live';
import { VideoPlayer } from '../src/players/video-player';

// ADR-0001 D5 - shared by native-media-player.ts (mp4/mp3). The HLS-native-
// without-MSE fallback branch is a documented gap (see hls-player.ts's
// goToLive() comment, and result.md) - not exercised here.
function video(): HTMLVideoElement {
  return document.createElement('video');
}

function setDuration(el: HTMLVideoElement, value: number) {
  Object.defineProperty(el, 'duration', { configurable: true, value });
}

describe('watchNativeLive (ADR-0001 D5)', () => {
  it("'auto': isLive follows duration === Infinity, on durationchange/loadedmetadata", () => {
    const el = video();
    const report = jest.fn();
    watchNativeLive(el, 'auto', report, jest.fn());

    setDuration(el, Infinity);
    el.dispatchEvent(new Event('durationchange'));
    expect(report).toHaveBeenLastCalledWith(true, null, 2);

    setDuration(el, 42);
    el.dispatchEvent(new Event('durationchange'));
    expect(report).toHaveBeenLastCalledWith(false, null, undefined);
  });

  it('live: false never reports live even when duration is Infinity', () => {
    const el = video();
    const report = jest.fn();
    watchNativeLive(el, false, report, jest.fn());

    setDuration(el, Infinity);
    el.dispatchEvent(new Event('durationchange'));

    expect(report).not.toHaveBeenCalled();
  });

  it("live: true forces isLive even when duration isn't Infinity", () => {
    const el = video();
    const report = jest.fn();
    watchNativeLive(el, true, report, jest.fn());

    setDuration(el, 42);
    el.dispatchEvent(new Event('durationchange'));

    expect(report).toHaveBeenCalledWith(true, null, 2);
  });

  it('playheadDate combines getStartDate() with currentTime when the browser exposes it (Safari extension)', () => {
    const el = video();
    (el as any).getStartDate = () => new Date('2026-01-01T00:00:00Z');
    Object.defineProperty(el, 'currentTime', { configurable: true, value: 10 });
    const report = jest.fn();
    watchNativeLive(el, 'auto', report, jest.fn());

    setDuration(el, Infinity);
    el.dispatchEvent(new Event('durationchange'));

    expect(report).toHaveBeenCalledWith(true, new Date('2026-01-01T00:00:10Z'), 2);
  });

  it('ended() fires exactly once on the live -> non-live transition, not on later duration changes', () => {
    const el = video();
    const report = jest.fn();
    const ended = jest.fn();
    watchNativeLive(el, 'auto', report, ended);

    setDuration(el, Infinity);
    el.dispatchEvent(new Event('durationchange'));
    setDuration(el, 42);
    el.dispatchEvent(new Event('durationchange'));
    el.dispatchEvent(new Event('durationchange')); // still finite - must not re-fire

    expect(ended).toHaveBeenCalledTimes(1);
  });

  it('off() stops listening; reset() clears wasLive so a later ended() transition is tracked fresh', () => {
    const el = video();
    const report = jest.fn();
    const ended = jest.fn();
    const watch = watchNativeLive(el, 'auto', report, ended);

    setDuration(el, Infinity);
    el.dispatchEvent(new Event('durationchange'));
    watch.off();
    setDuration(el, 42);
    el.dispatchEvent(new Event('durationchange'));
    expect(ended).not.toHaveBeenCalled(); // off() already removed the listeners

    watch.reset();
    expect(watch.isLive()).toBe(false);
  });
});

describe('goToLiveViaSeekable', () => {
  it('seeks to the end of the last seekable range', () => {
    const el = video();
    Object.defineProperty(el, 'seekable', { configurable: true, value: { length: 1, start: () => 0, end: () => 30 } });
    Object.defineProperty(el, 'currentTime', { configurable: true, value: 0, writable: true });

    goToLiveViaSeekable(el);

    expect(el.currentTime).toBe(30);
  });

  it('does nothing with an empty seekable range', () => {
    const el = video();
    Object.defineProperty(el, 'seekable', { configurable: true, value: { length: 0, start: () => 0, end: () => 0 } });
    Object.defineProperty(el, 'currentTime', { configurable: true, value: 5, writable: true });

    goToLiveViaSeekable(el);

    expect(el.currentTime).toBe(5);
  });
});

// End-to-end through NativeMediaPlayer's public IMediaPlayer surface
// (VideoPlayer/AudioPlayer share this - see native-media-player.ts).
describe('VideoPlayer live (ADR-0001 D5, via NativeMediaPlayer)', () => {
  it('reports isLive through onLiveChange, and goToLive()/no-op mirror watchNativeLive', () => {
    const el = video();
    const player = new VideoPlayer(el, 'auto');
    const onLiveChange = jest.fn();
    player.onLiveChange(onLiveChange);

    Object.defineProperty(el, 'seekable', { configurable: true, value: { length: 1, start: () => 0, end: () => 20 } });
    Object.defineProperty(el, 'currentTime', { configurable: true, value: 0, writable: true });

    player.goToLive(); // not live yet
    expect(el.currentTime).toBe(0);

    setDuration(el, Infinity);
    el.dispatchEvent(new Event('durationchange'));
    expect(onLiveChange).toHaveBeenCalledWith(true, null, 2);

    player.goToLive();
    expect(el.currentTime).toBe(20);
  });
});
