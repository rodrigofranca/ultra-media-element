// Defers play() on a <video> the host owns until the engine is actually
// listening for it, then replays it. dash.js only starts its periodic MPD
// refresh on PLAYBACK_STARTED, which it derives from a native `play`
// listener it attaches late (after the manifest is fetched) - a host that
// autoplays calls play() before that and the live stream would silently stop
// refreshing. Everything here has to look exactly like play()/pause() to the
// host (and to its ad stack, which drives the same element) and leave the
// element exactly as it was found.

function abortError(): Error {
  const error = new Error('The play() request was interrupted.');
  error.name = 'AbortError';
  return error;
}

type Settle = { resolve: () => void; reject: (reason: unknown) => void };
type Method = 'play' | 'pause';

export class PlayGuard {
  private armed = false;
  private wantsPlay = false;
  private pending: Settle[] = [];
  private own: Partial<Record<Method, PropertyDescriptor | undefined>> = {};
  private ours: Partial<Record<Method, unknown>> = {};
  private hadAutoplay = false;
  private watchdog: ReturnType<typeof setTimeout> | null = null;

  // Nothing can play before the engine attaches a source anyway, so holding
  // play() costs the host nothing - but it must never be held forever: if the
  // engine goes silent (no ready signal, no error), let the play() through.
  constructor(private media: HTMLMediaElement, private watchdogMs = 15000) {}

  arm(): void {
    if (this.armed) return;
    this.armed = true;
    const media = this.media;
    this.own.play = Object.getOwnPropertyDescriptor(media, 'play');
    this.own.pause = Object.getOwnPropertyDescriptor(media, 'pause');
    const realPause = media.pause;

    // The autoplay attribute is an intent to play too - hold it back the
    // same way, and put it back on release.
    this.hadAutoplay = media.autoplay;
    if (this.hadAutoplay) {
      this.wantsPlay = true;
      media.autoplay = false;
    }

    this.define('play', (): Promise<void> => {
      this.wantsPlay = true;
      return new Promise<void>((resolve, reject) => {
        this.pending.push({ resolve, reject });
      });
    });
    this.define('pause', (): void => {
      this.wantsPlay = false;
      this.settle(abortError());
      realPause.call(media);
    });
    this.watchdog = setTimeout(() => this.release(true), this.watchdogMs);
  }

  // invoke=true: the engine is listening now - run the real play() if the
  // host still wants it. invoke=false: torn down/superseded - just undo.
  release(invoke: boolean): void {
    if (!this.armed) return;
    this.armed = false;
    if (this.watchdog !== null) clearTimeout(this.watchdog);
    this.watchdog = null;
    this.restore('play');
    this.restore('pause');
    if (this.hadAutoplay) this.media.autoplay = true;
    this.hadAutoplay = false;

    const wantsPlay = this.wantsPlay;
    this.wantsPlay = false;
    if (!invoke || !wantsPlay) {
      this.settle(abortError());
      return;
    }
    const pending = this.pending;
    this.pending = [];
    let result: Promise<void> | void;
    try {
      result = this.media.play();
    } catch (error) {
      pending.forEach((p) => p.reject(error));
      return;
    }
    Promise.resolve(result).then(
      () => pending.forEach((p) => p.resolve()),
      (error) => pending.forEach((p) => p.reject(error)),
    );
  }

  private settle(error: Error): void {
    const pending = this.pending;
    this.pending = [];
    pending.forEach((p) => p.reject(error));
  }

  private define(name: Method, value: unknown): void {
    this.ours[name] = value;
    Object.defineProperty(this.media, name, { configurable: true, writable: true, enumerable: false, value });
  }

  // Back to the host's own override if it had one, otherwise drop ours so the
  // prototype's native method shows through again.
  // If someone else (an ad SDK) replaced the method after we armed, it is
  // theirs now - leave it alone instead of clobbering it with the old one.
  private restore(name: Method): void {
    const descriptor = this.own[name];
    this.own[name] = undefined;
    const stillOurs = (this.media as any)[name] === this.ours[name];
    this.ours[name] = undefined;
    if (!stillOurs) return;
    if (descriptor) Object.defineProperty(this.media, name, descriptor);
    else delete (this.media as any)[name];
  }
}
