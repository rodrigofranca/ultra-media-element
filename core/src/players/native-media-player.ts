import type { IMediaPlayer, MediaPlayerError } from "../core/media-player";
import type { RequestPolicy } from "../core/request-policy";
import { applyNativeLoad, deferredGuardedReport, restoreCrossOrigin, type CrossOriginBackup } from "../core/apply-request-policy";
import { watchNativeLive, goToLiveViaSeekable, type NativeLiveWatch } from "../core/native-live";
import { mapNativeMediaError } from "./native-media-error";

/** VideoPlayer/AudioPlayer are identical but for the `engine` string - shared to avoid shipping defect 2/3's fixes twice. */
export class NativeMediaPlayer implements IMediaPlayer {
  public onReady: Promise<void> = Promise.resolve();
  private errorHandler?: (e: Event) => void;
  private errorCallback?: (error: MediaPlayerError) => void;
  private crossOriginState: CrossOriginBackup = [null, null];
  private loadGeneration = 0;
  private destroyed = false;
  private streamEndedCallback?: () => void;
  private live?: NativeLiveWatch;

  constructor(protected element: HTMLMediaElement, private engine: string, private liveOpt?: boolean | 'auto') {}

  load(src: string, requestPolicy?: RequestPolicy): void {
    const generation = ++this.loadGeneration;
    this.live?.reset();
    this.element.src = applyNativeLoad(this.element, src, 'other', this.engine, requestPolicy, deferredGuardedReport(
      (e) => this.errorCallback?.(e),
      () => !this.destroyed && generation === this.loadGeneration,
    ), this.crossOriginState);
  }

  onLiveChange(callback: (isLive: boolean, playheadDate: Date | null) => void): void {
    this.live = watchNativeLive(this.element, this.liveOpt, callback, () => this.streamEndedCallback?.());
  }

  onStreamEnded(callback: () => void): void {
    this.streamEndedCallback = callback;
  }

  goToLive(): void {
    if (this.live?.isLive()) goToLiveViaSeekable(this.element);
  }

  onError(callback: (error: MediaPlayerError) => void) {
    this.errorCallback = callback;
    if (this.errorHandler) {
      this.element.removeEventListener('error', this.errorHandler);
    }
    this.errorHandler = () => {
      if (!this.element.error) return;
      callback(mapNativeMediaError(this.element.error, this.engine, this.element.currentSrc || this.element.src));
    };
    this.element.addEventListener('error', this.errorHandler);
  }

  destroy(): void {
    this.destroyed = true;
    if (this.errorHandler) {
      this.element.removeEventListener('error', this.errorHandler);
      this.errorHandler = undefined;
    }
    this.live?.off();
    this.live = undefined;
    restoreCrossOrigin(this.element, this.crossOriginState);
    this.element.removeAttribute('src');
    this.element.load();
  }
}
