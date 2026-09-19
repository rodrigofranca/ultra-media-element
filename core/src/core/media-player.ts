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
  load(src: string): void;
  destroy(): void;
  onTracksChange?(callback: (tracks: MediaTracks) => void): void;
  onError?(callback: (error: MediaPlayerError) => void): void;
  switchAudioTrack?(trackId: string): void;
  switchRendition?(renditionId: string): void;
}

export type AvailableFormats = {
  [key: string]: string;
};
