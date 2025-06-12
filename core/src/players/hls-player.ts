import type { IMediaPlayer, MediaTracks } from "../core/media-player";
import { log } from "../utils/log";
import { loadSDK } from "../utils/network";
import { isUndefined } from "../utils/unit";

export class HlsPlayer implements IMediaPlayer {
  private nativeEl: HTMLVideoElement;
  public onReady: Promise<void>;
  private Hls: any;
  private hls: any;
  private sdkSrc: string = 'https://cdn.jsdelivr.net/npm/hls.js@latest/dist/hls.min.js';
  private config = {}
  private tracksChangeCallback?: (tracks: MediaTracks) => void;

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
    this.hls = new this.Hls(this.config);
    this.hls.attachMedia(this.nativeEl);

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
  }

  onTracksChange(callback: (tracks: MediaTracks) => void) {
    this.tracksChangeCallback = callback;
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
    if (this.hls) {
      this.hls.destroy();
      this.hls = null;
    }
  }

  load(src: string){
    if (!this.Hls) return;
    if (this.Hls?.isSupported()) {
      this.hls.loadSource(src);
    } else if (this.nativeEl.canPlayType("application/vnd.apple.mpegurl")) {
      this.nativeEl.src = src;
    } else {
      console.error("HLS não suportado no navegador.");
    }
  }
}
