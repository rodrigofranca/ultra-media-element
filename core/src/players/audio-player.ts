import type { IMediaPlayer, MediaPlayerError } from "../core/media-player";
import { mapNativeMediaError } from "./native-media-error";

export class AudioPlayer implements IMediaPlayer {
  public onReady: Promise<void>;
  private errorHandler?: (e: Event) => void;

  constructor(private element: HTMLVideoElement) {
    this.onReady = Promise.resolve();
  }

  load(src: string): void {
    this.element.src = src;
  }

  onError(callback: (error: MediaPlayerError) => void) {
    this.errorHandler = () => {
      callback(mapNativeMediaError(this.element.error, 'audio/mp3', this.element.currentSrc || this.element.src));
    };
    this.element.addEventListener('error', this.errorHandler);
  }

  destroy(): void {
    if (this.errorHandler) {
      this.element.removeEventListener('error', this.errorHandler);
      this.errorHandler = undefined;
    }
    this.element.removeAttribute('src');
    this.element.load();
  }
}
