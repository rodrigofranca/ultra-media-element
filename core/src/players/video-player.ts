import { NativeMediaPlayer } from "./native-media-player";

export class VideoPlayer extends NativeMediaPlayer {
  constructor(element: HTMLVideoElement, live?: boolean | 'auto') {
    super(element, 'video/mp4', live);
  }
}
