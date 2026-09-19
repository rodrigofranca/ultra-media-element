import type { IMediaPlayer, MediaTracks, MediaPlayerError } from "../core/media-player";
import { log } from "../utils/log";
import { loadSDK } from "../utils/network";
import { isUndefined } from "../utils/unit";
import { DASHJS_SDK_URL } from "../core/sdk-config";

export class DashPlayer implements IMediaPlayer {
  private nativeEl: HTMLVideoElement;
  public onReady: Promise<void>;
  private dashjs: any;
  private player: any;
  private sdkSrc: string = DASHJS_SDK_URL;
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
  private errorCallback?: (error: MediaPlayerError) => void;
  private audioTracks: any[] = [];
  private videoRepresentations: any[] = [];

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

    this.player.on(this.dashjs.MediaPlayer.events.ERROR, (e: any) => {
      if (this.errorCallback) {
        this.errorCallback({
          type: 'networkError',
          details: e.error?.message || 'unknown',
          fatal: true,
          statusCode: e.error?.data?.request?.response?.status,
          url: e.error?.data?.request?.url,
          message: e.error?.message,
        });
      }
    });

    this.player.on(this.dashjs.MediaPlayer.events.STREAM_INITIALIZED, () => {
      if (this.tracksChangeCallback) {
        const audioTracks = this.player.getTracksFor('audio');
        // One entry per bitrate Representation of the current video
        // MediaInfo - not one per AdaptationSet like getTracksFor('video')
        // returns (see result.md "decisões de design" - confirmed by
        // reading Stream#getRepresentationsByType in
        // dist/modern/umd/dash.all.debug.js). Indices here line up 1:1
        // with setRepresentationForTypeByIndex, which reads from the same
        // underlying list, so manual rendition selection keeps working.
        const videoRepresentations = this.player.getRepresentationsByType('video');
        this.audioTracks = audioTracks;
        this.videoRepresentations = videoRepresentations;

        const tracks: MediaTracks = {
          audio: audioTracks?.map((track: any, index: number) => ({
            id: `${index}`,
            kind: track.roles?.includes('main') ? 'main' : 'alternative',
            label: track.lang || `Audio ${index + 1}`,
            language: track.lang,
            default: track.roles?.includes('main')
          })),
          renditions: videoRepresentations?.map((representation: any, index: number) => ({
            id: `${index}`,
            width: representation.width,
            height: representation.height,
            bitrate: representation.bandwidth,
            frameRate: representation.frameRate,
            codec: representation.codecs
          }))
        };
        this.tracksChangeCallback(tracks);
      }
    });
  }

  onTracksChange(callback: (tracks: MediaTracks) => void) {
    this.tracksChangeCallback = callback;
  }

  onError(callback: (error: MediaPlayerError) => void) {
    this.errorCallback = callback;
  }

  switchAudioTrack(trackId: string) {
    if (!this.player || !this.audioTracks) return;
    const audioTrackId = parseInt(trackId, 10);
    if (!isNaN(audioTrackId) && this.audioTracks[audioTrackId]) {
      this.player.setCurrentTrack(this.audioTracks[audioTrackId]);
    }
  }

  switchRendition(renditionId: string) {
    if (!this.player || !this.videoRepresentations) return;
    const index = parseInt(renditionId, 10);
    if (!isNaN(index) && this.videoRepresentations[index]) {
      this.player.setRepresentationForTypeByIndex('video', index);
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
