import { normalizeLiveDate } from './live-date';

/**
 * ADR-0001 D5 - shared "is this native-driven <video> live" detection, used
 * by native-media-player.ts (mp4/mp3) and hls-player.ts's native-HLS-
 * without-MSE fallback (Safari/older TVs, result-cycle2.md defect 1) - both
 * drive playback purely through the browser's own resource-selection
 * algorithm, so both read the same signals: `duration === Infinity` for
 * isLive, `getStartDate()` (Safari's non-standard HLS extension - absent
 * everywhere else) for playheadDate.
 *
 * No manifest is available on this path to derive a per-stream live-sync
 * distance from (unlike hls.js/dash.js - result-cycle2.md, defect 8), so
 * `liveEdgeOffsetSeconds` is a documented flat heuristic instead.
 */
export const NATIVE_LIVE_EDGE_OFFSET_SECONDS = 2;

export interface NativeLiveWatch {
  off(): void;
  reset(): void;
  isLive(): boolean;
}

export function watchNativeLive(
  element: HTMLMediaElement,
  liveOpt: boolean | 'auto' | undefined,
  report: (isLive: boolean, playheadDate: Date | null, liveEdgeOffsetSeconds?: number) => void,
  ended: () => void,
): NativeLiveWatch {
  if (liveOpt === false) return { off: () => {}, reset: () => {}, isLive: () => false };
  let wasLive = false;
  const handler = () => {
    const live = liveOpt === true || element.duration === Infinity;
    if (wasLive && !live) ended();
    wasLive = live;
    const start: Date | undefined = (element as unknown as { getStartDate?(): Date }).getStartDate?.();
    const playheadDate = live && start ? normalizeLiveDate(new Date(+start + element.currentTime * 1000)) : null;
    report(live, playheadDate, live ? NATIVE_LIVE_EDGE_OFFSET_SECONDS : undefined);
  };
  // result-cycle2.md, defect 8: durationchange/loadedmetadata alone only
  // report at load start - a DVR window that grows over the course of
  // playback (live with DVR from the start) never updated `core.live`
  // again. `progress`/`timeupdate` cover that; the granularity/dedup rule
  // that keeps this from flooding `livechange` lives in UltraMediaCore
  // (result-cycle2.md, defect 7), not here.
  element.addEventListener('durationchange', handler);
  element.addEventListener('loadedmetadata', handler);
  element.addEventListener('progress', handler);
  element.addEventListener('timeupdate', handler);
  return {
    off: () => {
      element.removeEventListener('durationchange', handler);
      element.removeEventListener('loadedmetadata', handler);
      element.removeEventListener('progress', handler);
      element.removeEventListener('timeupdate', handler);
    },
    reset: () => { wasLive = false; },
    isLive: () => wasLive,
  };
}

/** goToLive() fallback shared by every engine that has no better SDK-native edge position. */
export function goToLiveViaSeekable(element: HTMLMediaElement): void {
  const seekable = element.seekable;
  if (seekable.length) element.currentTime = seekable.end(seekable.length - 1);
}
