import type { RequestPolicy } from './request-policy';
export type { RequestContext, RequestPolicy } from './request-policy';

export interface MediaTrack {
  id: string;
  kind?: string;
  label: string;
  language: string;
  default?: boolean;
}

export interface VideoRendition {
  id: string;
  width?: number;
  height?: number;
  bitrate?: number;
  frameRate?: number;
  codec?: string;
}

export interface MediaTracks {
  audio?: MediaTrack[];
  renditions?: VideoRendition[];
}

/**
 * ADR-0001 D5 - immutable, frozen snapshot (result-cycle2.md, defect 3):
 * `UltraMediaCore.live` always returns a fresh `Object.freeze`d object with
 * its own `playheadDate` (a new `Date`, never a reference shared with a
 * previous snapshot or the engine's own internal one) - mutating a returned
 * snapshot (or its `playheadDate`) can never leak into another snapshot or
 * into the core's own state.
 *
 * `isLive`/`seekableStart`/`seekableEnd`/`liveEdge`/`dvr` only change (and
 * only then does `livechange` fire) when a player reports a relevant
 * transition (result-cycle2.md, defect 7); `playheadDate`/`latency` are
 * instead recomputed fresh on every read of `core.live` from the last
 * engine-reported reference point + how far `currentTime` has moved since -
 * see `UltraMediaCore`'s "instant" getter, `result-cycle2.md`.
 *
 * `liveEdge`/`dvr` are derived from a per-engine "distance from
 * seekableEnd to the normal live-sync position" (hls.js `liveSyncPosition`/
 * `targetLatency`, dash.js `getTargetLiveDelay()`, a documented heuristic
 * for native playback) - see result-cycle2.md, defect 8.
 */
export interface LiveInfo {
  readonly isLive: boolean;
  readonly seekableStart: number;
  readonly seekableEnd: number;
  readonly liveEdge: number;
  readonly dvr: boolean;
  /** Seconds `currentTime` trails `liveEdge` by; `undefined` when not live. Read on demand - see the type doc comment. */
  readonly latency?: number;
  readonly playheadDate: Date | null;
}

export type MediaErrorCategory = 'networkError' | 'mediaError' | 'otherError';

/**
 * Uniform shape every engine's `onError` callback reports, whether the
 * player surfaces it as a fatal `error` or a recoverable `warning` (that
 * routing decision is made once, centrally, in ultra-media-element.ts based
 * on `fatal` - see result.md "decisões de design").
 */
export interface MediaPlayerError {
  fatal: boolean;
  category: MediaErrorCategory;
  code: string;
  message: string;
  engine: string;
  url?: string;
  status?: number;
  cause?: unknown;
}

export interface IMediaPlayer {
  onReady: Promise<void>;
  /**
   * `live` (result-cycle2.md, defect 4): applies starting with *this*
   * load() - lets `configure({ live })` reach an engine reused across a
   * same-format `load()`, exactly like `requestPolicy`. Omitted/`undefined`
   * behaves like `'auto'`, same as the constructor-time default.
   */
  load(src: string, requestPolicy?: RequestPolicy, live?: boolean | 'auto'): void;
  destroy(): void;
  onTracksChange?(callback: (tracks: MediaTracks) => void): void;
  onError?(callback: (error: MediaPlayerError) => void): void;
  switchAudioTrack?(trackId: string): void;
  switchRendition?(renditionId: string): void;
  /**
   * ADR-0001 D5 - reports isLive/playheadDate on every manifest signal, plus
   * (result-cycle2.md, defect 8) `liveEdgeOffsetSeconds`: this engine's
   * current "normal" distance from `seekableEnd` to its own live-sync
   * position (hls.js `liveSyncPosition`/`targetLatency`, dash.js
   * `getTargetLiveDelay()`, a documented heuristic for native playback) -
   * `undefined` when the engine has no opinion yet. The core derives the
   * rest of LiveInfo from these plus `media.seekable`/`currentTime`.
   */
  onLiveChange?(callback: (isLive: boolean, playheadDate: Date | null, liveEdgeOffsetSeconds?: number) => void): void;
  /** Fires once per live->non-live transition (ENDLIST/static MPD/terminal manifest 404/native duration leaving Infinity). */
  onStreamEnded?(callback: () => void): void;
  /** No-op when not currently live. */
  goToLive?(): void;
}

export type AvailableFormats = {
  [key: string]: string;
};
