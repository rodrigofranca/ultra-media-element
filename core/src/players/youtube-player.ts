import type { IMediaPlayer, MediaTracks } from "../core/media-player";

const API_URL = 'https://www.youtube.com/iframe_api';
const API_GLOBAL = 'YT';
const API_GLOBAL_READY = 'onYouTubeIframeAPIReady';

// Regex to extract video ID from YouTube URLs
const MATCH_SRC = /(?:youtu\.be\/|youtube\.com\/(?:shorts\/|embed\/|v\/|watch\?v=|watch\?.+&v=))((\w|-){11})/;

let apiLoaded: Promise<any> | null = null;

function loadYouTubeAPI() {
  console.log('loadYouTubeAPI');
  if (!apiLoaded) {
    apiLoaded = new Promise((resolve) => {
      console.log('loadYouTubeAPI promise');
      if (window[API_GLOBAL] && window[API_GLOBAL].Player) {
        return resolve(window[API_GLOBAL]);
      }

      const script = document.createElement('script');
      script.src = API_URL;
      window[API_GLOBAL_READY] = () => {
        resolve(window[API_GLOBAL]);
      };
      document.head.appendChild(script);
    });
  }
  return apiLoaded;
}

export class YouTubePlayer implements IMediaPlayer {
  public onReady: Promise<void>;
  private player: any; // YT.Player
  private iframe: HTMLIFrameElement | null = null;
  private container: HTMLElement;
  private timeUpdateInterval: any;

  constructor(private element: HTMLMediaElement, container?: HTMLElement) {
    console.log('YouTubePlayer constructor');
    this.container = container || element;
    this.onReady = loadYouTubeAPI();
  }

  load(src: string): void {
    this.onReady.then(() => {
      const videoId = src.match(MATCH_SRC)?.[1];
      if (!videoId) {
        console.error('Invalid YouTube URL');
        return;
      }

      if (this.iframe) {
        this.destroy();
      }

      // Hide the original video element
      this.element.style.display = 'none';

      this.iframe = document.createElement('iframe');
      this.iframe.style.width = '100%';
      this.iframe.style.height = '100%';
      this.iframe.style.position = 'absolute';
      this.iframe.style.top = '0';
      this.iframe.style.left = '0';
      this.iframe.frameBorder = '0';
      this.iframe.allow = 'accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture';
      this.container.appendChild(this.iframe);

      this.player = new window[API_GLOBAL].Player(this.iframe, {
        videoId,
        playerVars: {
          autoplay: this.element.autoplay ? 1 : 0,
          controls: this.element.controls ? 1 : 0,
          loop: this.element.loop ? 1 : 0,
          muted: this.element.muted ? 1 : 0,
          playsinline: 1,
        },
        events: {
          onReady: () => this.onPlayerReady(),
          onStateChange: (event: any) => this.onPlayerStateChange(event),
          onPlaybackRateChange: (event: any) => this.onPlaybackRateChange(event),
        },
      });
    });
  }

  destroy(): void {
    if (this.player) {
      this.player.destroy();
      this.player = null;
    }
    if (this.iframe) {
      this.iframe.remove();
      this.iframe = null;
    }
    if (this.timeUpdateInterval) {
      clearInterval(this.timeUpdateInterval);
    }
    // Restore the original video element's display
    this.element.style.display = '';
  }

  private onPlayerReady(): void {
    this.container.dispatchEvent(new Event('durationchange'));
  }

  private onPlayerStateChange(event: any): void {
    const state = event.data;
    const YT = window[API_GLOBAL];

    // Dispatch events on the container (the ultra-media-element)
    switch (state) {
      case YT.PlayerState.PLAYING:
        this.container.dispatchEvent(new Event('play'));
        this.container.dispatchEvent(new Event('playing'));
        this.startTimeUpdate();
        break;
      case YT.PlayerState.PAUSED:
        this.container.dispatchEvent(new Event('pause'));
        this.stopTimeUpdate();
        break;
      case YT.PlayerState.ENDED:
        this.container.dispatchEvent(new Event('ended'));
        this.stopTimeUpdate();
        break;
      case YT.PlayerState.BUFFERING:
        this.container.dispatchEvent(new Event('waiting'));
        break;
    }
  }

  private onPlaybackRateChange(event: any): void {
    this.container.dispatchEvent(new Event('ratechange'));
  }

  private startTimeUpdate(): void {
    this.timeUpdateInterval = setInterval(() => {
      this.container.dispatchEvent(new Event('timeupdate'));
    }, 250);
  }

  private stopTimeUpdate(): void {
    clearInterval(this.timeUpdateInterval);
  }

  // Methods to control the player, mapping to the element's properties/methods
  play(): void {
    this.player?.playVideo();
  }

  pause(): void {
    this.player?.pauseVideo();
  }

  get muted(): boolean {
    return this.player?.isMuted();
  }

  set muted(value: boolean) {
    if (value) {
      this.player?.mute();
    } else {
      this.player?.unMute();
    }
  }

  get volume(): number {
    return this.player?.getVolume() / 100;
  }

  set volume(value: number) {
    this.player?.setVolume(value * 100);
  }

  get currentTime(): number {
    return this.player?.getCurrentTime();
  }

  set currentTime(value: number) {
    this.player?.seekTo(value, true);
  }

  get duration(): number {
    return this.player?.getDuration();
  }
}
