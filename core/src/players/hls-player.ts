import type { IMediaPlayer } from "../core/media-player";
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
