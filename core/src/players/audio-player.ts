import { NativeMediaPlayer } from "./native-media-player";

export class AudioPlayer extends NativeMediaPlayer {
  constructor(element: HTMLVideoElement, live?: boolean | 'auto') {
    super(element, 'audio/mp3', live);
  }
}
