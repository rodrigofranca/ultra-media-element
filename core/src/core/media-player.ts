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

export interface IMediaPlayer {
  onReady: Promise<void>;
  load(src: string): void;
  destroy(): void;
  onTracksChange?(callback: (tracks: MediaTracks) => void): void;
  switchAudioTrack?(trackId: string): void;
  switchRendition?(renditionId: string): void;
}

export type AvailableFormats = {
  [key: string]: string;
};
