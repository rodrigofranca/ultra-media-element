import { NativeMediaPlayer } from "./native-media-player";

export class AudioPlayer extends NativeMediaPlayer {
  constructor(element: HTMLVideoElement) {
    super(element, 'audio/mp3');
  }
}
