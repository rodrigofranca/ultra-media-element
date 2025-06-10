import type { IMediaPlayer } from "../core/media-player";
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
        autoSwitchBitrate: true
      }
    }
  };

  constructor(private element: HTMLVideoElement) {
    log("Powered by dash.js");
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