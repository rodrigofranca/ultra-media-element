import type { IMediaPlayer } from "../core/media-player";

class TimeRanges {
  private ranges: [number, number][];

  constructor(start = 0, end = 0) {
    this.ranges = [];
    if (start !== 0 || end !== 0) {
      this.ranges.push([start, end]);
    }
  }

  get length(): number {
    return this.ranges.length;
  }

  start(index: number): number {
    return this.ranges[index]?.[0] ?? 0;
  }

  end(index: number): number {
    return this.ranges[index]?.[1] ?? 0;
  }
}

const API_URL = 'https://www.youtube.com/iframe_api';
const API_GLOBAL = 'YT';
const API_GLOBAL_READY = 'onYouTubeIframeAPIReady';

// Regex to extract video ID from YouTube URLs
const MATCH_SRC = /(?:youtu\.be\/|youtube\.com\/(?:shorts\/|embed\/|v\/|watch\?v=|watch\?.+&v=))((\w|-){11})/;

let apiLoaded: Promise<any> | null = null;

function loadYouTubeAPI() {
  if (!apiLoaded) {
    apiLoaded = new Promise((resolve) => {
      if (window[API_GLOBAL] && window[API_GLOBAL].Player) {
        return resolve(window[API_GLOBAL]);
      }

      const script = document.createElement('script');
      script.src = API_URL;
      window[API_GLOBAL_READY] = () => {
        resolve(window[API_GLOBAL]);
      };
      const firstScriptTag = document.getElementsByTagName('script')[0];
      firstScriptTag.parentNode?.insertBefore(script, firstScriptTag);
    });
  }
  return apiLoaded;
}

// Interface for managing element proxy functionality
interface ElementProxy {
  setupProxy(): void;
  cleanupProxy(): void;
}

export class YouTubePlayer implements IMediaPlayer, ElementProxy {
  public onReady: Promise<void>;
  private player: any; // YT.Player
  private iframe: HTMLIFrameElement | null = null;
  private container: HTMLElement;
  private timeUpdateInterval: any;
  private progressInterval: any;
  private isLoaded = false;
  private lastCurrentTime = 0;
  private seeking = false;

  // Backup of original HTMLMediaElement methods for restoration
  private originalMethods = {
    play: null as (() => Promise<void>) | null,
    pause: null as (() => void) | null,
    load: null as (() => void) | null
  };

  // Property descriptors backup for restoration
  private originalDescriptors: Map<string, PropertyDescriptor> = new Map();

  constructor(private element: HTMLMediaElement, container: HTMLElement) {
    this.container = container;
    this.onReady = loadYouTubeAPI();

    // Backup original methods (store references, not bound versions)
    this.originalMethods.play = this.element.play;
    this.originalMethods.pause = this.element.pause;
    this.originalMethods.load = this.element.load;
  }

  // Setup the proxy system
  setupProxy(): void {
    this.setupPropertyProxies();
    this.setupMethodProxies();
    console.log('YouTubePlayer: Proxy setup initiated');
  }

  private setupPropertyProxies(): void {
    // Backup original property descriptors before overriding
    this.backupOriginalProperty('currentTime');
    this.backupOriginalProperty('duration');
    this.backupOriginalProperty('volume');
    this.backupOriginalProperty('muted');
    this.backupOriginalProperty('paused');
    this.backupOriginalProperty('buffered');
    this.backupOriginalProperty('playbackRate');
    this.backupOriginalProperty('ended');

    // currentTime - read/write property
    Object.defineProperty(this.element, 'currentTime', {
      get: () => {
        if (!this.player || typeof this.player.getCurrentTime !== 'function') return 0;
        return this.player.getCurrentTime() || 0;
      },
      set: (value: number) => {
        if (this.player && typeof value === 'number' && !isNaN(value)) {
          this.player.seekTo(value, true);
          this.element.dispatchEvent(new Event('seeking'));
        }
      },
      configurable: true,
      enumerable: true
    });

    // duration - read-only property
    Object.defineProperty(this.element, 'duration', {
      get: () => {
        if (!this.player || typeof this.player.getDuration !== 'function') return NaN;
        const duration = this.player.getDuration();
        return duration > 0 ? duration : NaN;
      },
      configurable: true,
      enumerable: true
    });

    // volume - read/write property (0.0 to 1.0)
    Object.defineProperty(this.element, 'volume', {
      get: () => {
        if (!this.player || typeof this.player.getVolume !== 'function') return 1.0;
        return (this.player.getVolume() || 100) / 100;
      },
      set: (value: number) => {
        if (this.player && typeof this.player.setVolume === 'function' && typeof value === 'number' && value >= 0 && value <= 1) {
          this.player.setVolume(value * 100);
          this.element.dispatchEvent(new Event('volumechange'));
        }
      },
      configurable: true,
      enumerable: true
    });

    // muted - read/write property
    Object.defineProperty(this.element, 'muted', {
      get: () => {
        if (!this.player || typeof this.player.isMuted !== 'function') return false;
        return this.player.isMuted() || false;
      },
      set: (value: boolean) => {
        if (this.player && typeof this.player.mute === 'function') {
          if (value) {
            this.player.mute();
          } else {
            this.player.unMute();
          }
          this.element.dispatchEvent(new Event('volumechange'));
        }
      },
      configurable: true,
      enumerable: true
    });

    // paused - read-only property
    Object.defineProperty(this.element, 'paused', {
      get: () => {
        if (!this.player || typeof this.player.getPlayerState !== 'function') return true;
        const state = this.player.getPlayerState();
        const YT = window[API_GLOBAL];
        return state !== YT.PlayerState.PLAYING;
      },
      configurable: true,
      enumerable: true
    });

    // buffered - read-only property
    Object.defineProperty(this.element, 'buffered', {
      get: () => {
        return this.buffered;
      },
      configurable: true,
      enumerable: true
    });

    // playbackRate - read/write property
    Object.defineProperty(this.element, 'playbackRate', {
      get: () => {
        if (!this.player || typeof this.player.getPlaybackRate !== 'function') return 1.0;
        return this.player.getPlaybackRate() || 1.0;
      },
      set: (value: number) => {
        if (this.player && typeof this.player.setPlaybackRate === 'function' && typeof value === 'number' && value > 0) {
          this.player.setPlaybackRate(value);
          this.element.dispatchEvent(new Event('ratechange'));
        }
      },
      configurable: true,
      enumerable: true
    });

    // ended - read-only property
    Object.defineProperty(this.element, 'ended', {
      get: () => {
        if (!this.player || typeof this.player.getPlayerState !== 'function') return false;
        const state = this.player.getPlayerState();
        const YT = window[API_GLOBAL];
        return state === YT.PlayerState.ENDED;
      },
      configurable: true,
      enumerable: true
    });
  }

  private backupOriginalProperty(propertyName: string): void {
    const descriptor = Object.getOwnPropertyDescriptor(this.element, propertyName) ||
                      Object.getOwnPropertyDescriptor(Object.getPrototypeOf(this.element), propertyName);

    if (descriptor) {
      this.originalDescriptors.set(propertyName, descriptor);
    }
  }

  private setupMethodProxies(): void {
    // Override play() method
    this.element.play = async (): Promise<void> => {
      if (this.player) {
        console.log('YouTubePlayer: Intercepted play() call');
        this.player.playVideo();
        return Promise.resolve();
      } else {
        console.log('YouTubePlayer: No player available, using original play()');
        return this.originalMethods.play ? this.originalMethods.play.call(this.element) : Promise.resolve();
      }
    };

    // Override pause() method
    this.element.pause = (): void => {
      if (this.player) {
        console.log('YouTubePlayer: Intercepted pause() call');
        this.player.pauseVideo();
      } else {
        console.log('YouTubePlayer: No player available, using original pause()');
        if (this.originalMethods.pause) {
          this.originalMethods.pause.call(this.element);
        }
      }
    };

    // Override load() method
    this.element.load = (): void => {
      if (this.player && this.element.src) {
        console.log('YouTubePlayer: Intercepted load() call');
        // For YouTube, load means reloading the current video
        this.load(this.element.src);
      } else {
        console.log('YouTubePlayer: No player/src available, using original load()');
        if (this.originalMethods.load) {
          this.originalMethods.load.call(this.element);
        }
      }
    };
  }

  // Cleanup the proxy system and restore original behavior
  cleanupProxy(): void {
    // Restore original methods
    if (this.originalMethods.play) {
      this.element.play = this.originalMethods.play;
    }
    if (this.originalMethods.pause) {
      this.element.pause = this.originalMethods.pause;
    }
    if (this.originalMethods.load) {
      this.element.load = this.originalMethods.load;
    }

    // Restore original property descriptors
    this.originalDescriptors.forEach((descriptor, property) => {
      try {
        // Delete the overridden property first
        delete (this.element as any)[property];

        // If we have an original descriptor, restore it
        if (descriptor.get || descriptor.set || descriptor.value !== undefined) {
          Object.defineProperty(this.element, property, descriptor);
        }
      } catch (e) {
        // Some properties might not be configurable, ignore errors
        console.warn(`Could not restore property ${property}:`, e);
      }
    });

    this.originalDescriptors.clear();
    console.log('YouTubePlayer: Proxy cleanup completed');
  }

  load(src: string): void {
    this.element.dispatchEvent(new Event('emptied'));
    this.element.dispatchEvent(new Event('loadstart'));

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
      this.iframe.style.maxWidth = '100%';
      this.iframe.style.maxHeight = '100%';
      this.iframe.style.minWidth = '100%';
      this.iframe.style.minHeight = '100%';
      this.iframe.frameBorder = '0';
      this.iframe.allow = 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share';
      this.iframe.referrerPolicy = 'strict-origin-when-cross-origin';
      this.iframe.allowFullscreen = true;
      this.iframe.src = `https://www.youtube.com/embed/${videoId}?controls=0&preload=metadata&enablejsapi=1&showinfo=0&rel=0&iv_load_policy=3&modestbranding=1`;

      // this.container.shadowRoot?.removeChild(this.element);
      this.container.shadowRoot?.appendChild(this.iframe);

      if (!this.iframe) {
        return;
      }

      this.player = new window[API_GLOBAL].Player(this.iframe, {
        playerVars: {
          autoplay: 1,
          loop: this.element.loop ? 1 : 0,
          muted: this.element.muted ? 1 : 0,
          playsinline: 1,
        },
        events: {
          onReady: () => this.onPlayerReady(),
          onStateChange: (event: any) => this.onPlayerStateChange(event),
          onPlaybackRateChange: (event: any) => this.onPlaybackRateChange(event),
          onError: (event: any) => this.onPlayerError(event),
        },
      });

      // Setup proxy system once player is initialized
      this.setupProxy();
    });
  }

  destroy(): void {
    // Cleanup proxy system first
    this.cleanupProxy();

    // Clear intervals
    if (this.timeUpdateInterval) {
      clearInterval(this.timeUpdateInterval);
    }
    if (this.progressInterval) {
      clearInterval(this.progressInterval);
    }

    // Destroy YouTube player
    if (this.player) {
      this.player.destroy();
      this.player = null;
    }

    // Remove iframe
    if (this.iframe) {
      this.iframe.remove();
      this.iframe = null;
    }

    // Restore the original video element's display
    this.element.style.display = '';
  }

  private onPlayerReady(): void {
    this.isLoaded = true;
    this.element.dispatchEvent(new Event('loadedmetadata'));
    this.element.dispatchEvent(new Event('durationchange'));
    this.element.dispatchEvent(new Event('volumechange'));
    this.element.dispatchEvent(new Event('canplay'));
    this.element.dispatchEvent(new Event('canplaythrough'));

    let lastBufferedEnd = 0;
    this.progressInterval = setInterval(() => {
      const bufferedEnd = this.buffered.end(this.buffered.length - 1);
      if (lastBufferedEnd != bufferedEnd) {
        lastBufferedEnd = bufferedEnd;
        this.element.dispatchEvent(new Event('progress'));
      }
    }, 100);
  }

  private onPlayerStateChange(event: any): void {
    const state = event.data;
    const YT = window[API_GLOBAL];

    // Dispatch events on the nativeEl for media-chrome compatibility
    switch (state) {
      case YT.PlayerState.PLAYING:
        if (this.seeking) {
          this.seeking = false;
          this.element.dispatchEvent(new Event('seeked'));
        }
        this.element.dispatchEvent(new Event('play'));
        this.element.dispatchEvent(new Event('playing'));
        this.startTimeUpdate();
        break;
      case YT.PlayerState.PAUSED:
        const diff = Math.abs(this.currentTime - this.lastCurrentTime);
        if (!this.seeking && diff > 0.1) {
          this.seeking = true;
          this.element.dispatchEvent(new Event('seeking'));
        }
        this.element.dispatchEvent(new Event('pause'));
        this.stopTimeUpdate();
        break;
      case YT.PlayerState.ENDED:
        this.element.dispatchEvent(new Event('ended'));
        this.stopTimeUpdate();
        break;
      case YT.PlayerState.BUFFERING:
        this.element.dispatchEvent(new Event('waiting'));
        break;
    }
  }

  private onPlaybackRateChange(event: any): void {
    this.element.dispatchEvent(new Event('ratechange'));
  }

  private onPlayerError(event: any): void {
    console.error('YouTubePlayer onPlayerError', event);
  }

  private startTimeUpdate(): void {
    this.timeUpdateInterval = setInterval(() => {
      this.element.dispatchEvent(new Event('timeupdate'));
    }, 250);
  }

  private stopTimeUpdate(): void {
    clearInterval(this.timeUpdateInterval);
    if (this.progressInterval) {
      clearInterval(this.progressInterval);
    }
  }

  // Methods to control the player, mapping to the element's properties/methods
  // play(): void {
  //   console.log('YouTubePlayer play', this.player);
  //   this.player?.playVideo();
  // }

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
    this.container.dispatchEvent(new Event('volumechange'));
  }

  get volume(): number {
    return this.player?.getVolume() / 100;
  }

  set volume(value: number) {
    this.player?.setVolume(value * 100);
    this.container.dispatchEvent(new Event('volumechange'));
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

  get buffered(): TimeRanges {
    if (!this.isLoaded) return new TimeRanges();
    const progress = this.player?.getVideoLoadedFraction() * this.player?.getDuration();
    if (progress > 0) {
      return new TimeRanges(0, progress);
    }
    return new TimeRanges();
  }
}
