import { NativeMediaPlayer } from "./native-media-player";

export class VideoPlayer extends NativeMediaPlayer {
  constructor(element: HTMLVideoElement) {
    super(element, 'video/mp4');
  }
}
