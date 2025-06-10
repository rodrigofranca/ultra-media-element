import type { IMediaPlayer } from "../core/media-player";

export class VideoPlayer implements IMediaPlayer {
  public onReady: Promise<void>;

  constructor(private element: HTMLVideoElement) {
    this.onReady = Promise.resolve();
  }

  load(src: string): void {
    this.element.src = src;
  }

  destroy(): void {
    this.element.src = '';
  }
}
