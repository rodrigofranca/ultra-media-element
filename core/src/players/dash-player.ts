import type { IMediaPlayer, MediaTracks } from "../core/media-player";
import { log } from "../utils/log";
import { loadSDK } from "../utils/network";
import { isUndefined } from "../utils/unit";

export class DashPlayer implements IMediaPlayer {
  private nativeEl: HTMLVideoElement;
  public onReady: Promise<void>;
  private dashjs: any;
  private player: any;
  private sdkSrc: string = 'https://cdn.jsdelivr.net/npm/dashjs@latest/dist/dash.all.min.js';
  private config = {
    streaming: {
      abr: {
        autoSwitchBitrate: {
          audio: true,
          video: true
        }
      }
    }
  };
  private tracksChangeCallback?: (tracks: MediaTracks) => void;
  private audioTracks: any[] = [];
  private videoTracks: any[] = [];

  constructor(private element: HTMLVideoElement) {
    log("Powered by Dash.js");
    this.nativeEl = element;
    this.onReady = new Promise((resolve, reject) => {
      this.setup().then(resolve).catch(reject);
    });
  }

  private async setup() {
    if (isUndefined(this.dashjs)) {
      this.dashjs = await loadSDK(this.sdkSrc, 'dashjs');
    }
    this.player = this.dashjs.MediaPlayer().create();
    this.player.initialize(this.nativeEl, null, true);
    this.player.updateSettings(this.config);

    this.player.on(this.dashjs.MediaPlayer.events.STREAM_INITIALIZED, () => {
      if (this.tracksChangeCallback) {
        const audioTracks = this.player.getTracksFor('audio');
        const videoTracks = this.player.getTracksFor('video');
        this.audioTracks = audioTracks;
        this.videoTracks = videoTracks;

        const tracks: MediaTracks = {
          audio: audioTracks?.map((track: any, index: number) => ({
            id: `${index}`,
            kind: track.roles?.includes('main') ? 'main' : 'alternative',
            label: track.lang || `Audio ${index + 1}`,
            language: track.lang,
            default: track.roles?.includes('main')
          })),
          renditions: videoTracks?.map((track: any, index: number) => ({
            id: `${index}`,
            width: track.width,
            height: track.height,
            bitrate: track.bitrate,
            frameRate: track.frameRate,
            codec: track.codec
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
    if (!this.player || !this.audioTracks) return;
    const audioTrackId = parseInt(trackId, 10);
    if (!isNaN(audioTrackId) && this.audioTracks[audioTrackId]) {
      this.player.setCurrentTrack(this.audioTracks[audioTrackId]);
    }
  }

  switchRendition(renditionId: string) {
    if (!this.player || !this.videoTracks) return;
    const videoTrackId = parseInt(renditionId, 10);
    if (!isNaN(videoTrackId) && this.videoTracks[videoTrackId]) {
      this.player.setQualityFor('video', videoTrackId);
    }
  }

  load(src: string) {
    if (!this.player) return;
    this.player.attachSource(src);
  }

  destroy() {
    if (this.player) {
      this.player.destroy();
      this.player = null;
    }
  }
}