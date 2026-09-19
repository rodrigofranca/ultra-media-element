import type { IMediaPlayer, MediaTracks, MediaPlayerError, MediaErrorCategory } from "../core/media-player";
import { log } from "../utils/log";
import { loadSDK } from "../utils/network";
import { isUndefined } from "../utils/unit";
import { HLS_JS_SDK_URL } from "../core/sdk-config";

// hls.js's own ErrorTypes ('networkError' | 'mediaError' | 'keySystemError'
// | 'muxError' | 'otherError') already line up with our category taxonomy
// for the two engine-agnostic buckets; the two hls-specific types collapse
// into the closest one (DRM out of scope - see AGENTS.md golden rule 4).
function categorizeHlsError(type: string): MediaErrorCategory {
  switch (type) {
    case 'networkError':
      return 'networkError';
    case 'mediaError':
    case 'muxError':
      return 'mediaError';
    default:
      return 'otherError';
  }
}

export class HlsPlayer implements IMediaPlayer {
  private nativeEl: HTMLVideoElement;
  public onReady: Promise<void>;
  private Hls: any;
  private hls: any;
  private sdkSrc: string = HLS_JS_SDK_URL;
  private config = {}
  private tracksChangeCallback?: (tracks: MediaTracks) => void;
  private errorCallback?: (error: MediaPlayerError) => void;
  // Guards the race between destroy()/a format-changing src swap and the
  // async CDN script load: player-factory.ts no longer waits on `onReady`
  // before returning, so `destroy()` can land here while `setup()` is still
  // awaiting `loadSDK()`. Checked right after that await, before `new
  // this.Hls(...)` - if set, the hls.js instance (and its manifest/segment
  // requests) is simply never created, instead of being created and
  // orphaned. See result.md "decisões de design".
  private destroyed = false;
  // The most recently requested src. `load()` can be called before `setup()`
  // has finished (same race as above) - it always records the intent here,
  // and only calls into hls.js directly once `this.hls` exists. `setup()`
  // applies it once, at the end, so a rapid A -> B -> C swap while the SDK
  // is still loading only ever loads C.
  private pendingSrc?: string;

  constructor(private element: HTMLVideoElement) {
    log("Powered by Hls.js");
    this.nativeEl = element;
    this.onReady = new Promise((resolve, reject) => {
      this.setup().then(resolve).catch(reject);
    });
  }

  private async setup() {
    if (isUndefined(this.Hls)) {
      this.Hls = await loadSDK(this.sdkSrc, 'Hls')
    }

    if (this.destroyed) return;

    this.hls = new this.Hls(this.config);
    this.hls.attachMedia(this.nativeEl);

    this.hls.on(this.Hls.Events.ERROR, (_event: any, data: any) => {
      if (this.errorCallback) {
        this.errorCallback({
          fatal: !!data.fatal,
          category: categorizeHlsError(data.type),
          code: data.details,
          message: data.error?.message || data.details,
          engine: 'hls.js',
          url: data.url,
          status: data.response?.code,
          cause: data.error,
        });
      }
    });

    this.hls.on(this.Hls.Events.MANIFEST_PARSED, (event: any, data: any) => {
      if (this.tracksChangeCallback) {
        const tracks: MediaTracks = {
          audio: data.audioTracks?.map((track: any, index: number) => ({
            id: `${index}`,
            kind: track.default ? 'main' : 'alternative',
            label: track.name,
            language: track.lang,
            default: track.default
          })),
          renditions: data.levels?.map((level: any, index: number) => ({
            id: `${index}`,
            width: level.width,
            height: level.height,
            bitrate: level.bitrate,
            frameRate: level.frameRate,
            codec: level.videoCodec
          }))
        };
        this.tracksChangeCallback(tracks);
      }
    });

    if (this.pendingSrc) {
      this.applyLoad(this.pendingSrc);
    }
  }

  private applyLoad(src: string) {
    if (this.Hls?.isSupported()) {
      this.hls.loadSource(src);
    } else if (this.nativeEl.canPlayType("application/vnd.apple.mpegurl")) {
      this.nativeEl.src = src;
    } else {
      console.error("HLS não suportado no navegador.");
    }
  }

  onTracksChange(callback: (tracks: MediaTracks) => void) {
    this.tracksChangeCallback = callback;
  }

  onError(callback: (error: MediaPlayerError) => void) {
    this.errorCallback = callback;
  }

  switchAudioTrack(trackId: string) {
    if (!this.hls) return;
    const audioTrackId = parseInt(trackId, 10);
    if (!isNaN(audioTrackId)) {
      this.hls.audioTrack = audioTrackId;
    }
  }

  switchRendition(renditionId: string) {
    if (!this.hls) return;
    const levelId = parseInt(renditionId, 10);
    if (!isNaN(levelId)) {
      this.hls.currentLevel = levelId;
    }
  }

  destroy() {
    this.destroyed = true;

    if (this.hls) {
      this.hls.destroy();
      this.hls = null;
    }
  }

  load(src: string) {
    this.pendingSrc = src;
    if (this.destroyed || !this.hls) return;
    this.applyLoad(src);
  }
}
