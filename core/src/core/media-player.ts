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
 * ADR-0001 D5 - immutable snapshot, rebuilt by UltraMediaCore.buildLiveInfo()
 * from `media.seekable`/`currentTime` (engine-agnostic: every MSE/native
 * engine already maintains a correct native `seekable`) every time a player
 * reports `isLive`/`playheadDate` via `onLiveChange`. `dvr`'s threshold and
 * `liveEdge === seekableEnd` are documented simplifications - see
 * result.md "critério de dvr/liveEdge".
 */
export interface LiveInfo {
  isLive: boolean;
  seekableStart: number;
  seekableEnd: number;
  liveEdge: number;
  dvr: boolean;
  latency?: number;
  playheadDate: Date | null;
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
  load(src: string, requestPolicy?: RequestPolicy): void;
  destroy(): void;
  onTracksChange?(callback: (tracks: MediaTracks) => void): void;
  onError?(callback: (error: MediaPlayerError) => void): void;
  switchAudioTrack?(trackId: string): void;
  switchRendition?(renditionId: string): void;
  /** ADR-0001 D5 - reports isLive/playheadDate on every manifest signal; the core derives the rest of LiveInfo. */
  onLiveChange?(callback: (isLive: boolean, playheadDate: Date | null) => void): void;
  /** Fires once per live->non-live transition (ENDLIST/static MPD/terminal manifest 404/native duration leaving Infinity). */
  onStreamEnded?(callback: () => void): void;
  /** No-op when not currently live. */
  goToLive?(): void;
}

export type AvailableFormats = {
  [key: string]: string;
};
