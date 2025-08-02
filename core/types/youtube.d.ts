// YouTube API type definitions
declare global {
  interface Window {
    YT: {
      Player: new (
        element: HTMLElement,
        options: {
          videoId: string;
          playerVars?: {
            autoplay?: number;
            controls?: number;
            loop?: number;
            muted?: number;
            playsinline?: number;
          };
          events?: {
            onReady?: () => void;
            onStateChange?: (event: { data: number }) => void;
          };
        }
      ) => YTPlayer;
      PlayerState: {
        PLAYING: number;
        PAUSED: number;
        ENDED: number;
      };
    };
    onYouTubeIframeAPIReady: () => void;
  }
}

interface YTPlayer {
  playVideo(): void;
  pauseVideo(): void;
  isMuted(): boolean;
  mute(): void;
  unMute(): void;
  getVolume(): number;
  setVolume(volume: number): void;
  getCurrentTime(): number;
  seekTo(seconds: number, allowSeekAhead: boolean): void;
  getDuration(): number;
  destroy(): void;
}

export {};