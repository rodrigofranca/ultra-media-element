/**
 * ADR-0001 D5 - shared "is this native-driven <video> live" detection, used
 * by native-media-player.ts (mp4/mp3) and hls-player.ts's native-HLS-
 * without-MSE fallback (Safari/older TVs) - both drive playback purely
 * through the browser's own resource-selection algorithm, so both read the
 * same signals: `duration === Infinity` for isLive, `getStartDate()` (Safari's
 * non-standard HLS extension - absent everywhere else) for playheadDate.
 */
export interface NativeLiveWatch {
  off(): void;
  reset(): void;
  isLive(): boolean;
}

export function watchNativeLive(
  element: HTMLMediaElement,
  liveOpt: boolean | 'auto' | undefined,
  report: (isLive: boolean, playheadDate: Date | null) => void,
  ended: () => void,
): NativeLiveWatch {
  if (liveOpt === false) return { off: () => {}, reset: () => {}, isLive: () => false };
  let wasLive = false;
  const handler = () => {
    const live = liveOpt === true || element.duration === Infinity;
    if (wasLive && !live) ended();
    wasLive = live;
    const start: Date | undefined = (element as unknown as { getStartDate?(): Date }).getStartDate?.();
    report(live, live && start ? new Date(+start + element.currentTime * 1000) : null);
  };
  element.addEventListener('durationchange', handler);
  element.addEventListener('loadedmetadata', handler);
  return {
    off: () => {
      element.removeEventListener('durationchange', handler);
      element.removeEventListener('loadedmetadata', handler);
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
