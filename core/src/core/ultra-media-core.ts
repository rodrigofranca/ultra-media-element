import type { IMediaPlayer, MediaTracks, MediaPlayerError, VideoRendition, MediaTrack } from './media-player';
import { PlayerFactory } from './player-factory';
import { Format } from './format';
import { detectFormat } from './format-detector';

/**
 * ADR-0001 D1/D2 - pure engine-orchestration class, zero runtime deps,
 * attaches to a media element it does not own. Everything here is a
 * verbatim move of what `ultra-media-element.ts` did beyond "being an
 * element": format detection, player selection, source-swap teardown, and
 * the single fatal->error / else->warning routing (see wireUp()).
 *
 * Dependency rule (enforced by tests/core-dependency-guard.test.ts and the
 * dist/ultra-media-core content check in tests/public-contract.test.ts):
 * nothing this file imports may pull in the element shell's own base class
 * (the Mux custom-element mixin it extends - see docs/adr/0001, D3),
 * `media-tracks`, the element shell itself, or use Custom Elements, Shadow
 * DOM, `ResizeObserver`, the `EventTarget` constructor, or `#` private
 * fields - the oldest Smart TV runtimes this is meant to run on may lack
 * all of those (ADR-0001, open question 1).
 */
export type UltraMediaSource = string | { src: string; type?: Format };

// Two UltraMediaCore instances attached to the same <video> would both
// react to its native events/drive its engine and corrupt each other's
// state - tracked here, module-wide, so the constructor can refuse a second
// attachment with a clear error instead (see result-cycle2.md, defect 4).
// Sequential reuse (destroy() -> new UltraMediaCore) still works: destroy()
// releases the entry.
const attachedMedia = new WeakSet<HTMLMediaElement>();

export interface UltraMediaCoreOptions {
  // A plain Node (not HTMLElement): the shell passes its shadow root (a
  // ShadowRoot - a Node with appendChild, not an HTMLElement) so the
  // YouTube iframe lands inside it instead of the element's light DOM (see
  // result-cycle2.md, defect 2) - the core itself only ever calls
  // `container.appendChild(...)`, never anything shadow-DOM-specific,
  // keeping it agnostic to what kind of Node it was given.
  /** Where engines that render outside the <video> (YouTube) mount their view. */
  container?: Node;
}

export type UltraMediaCoreEventType =
  | 'error'
  | 'warning'
  | 'ready'
  | 'sourcechange'
  | 'enginechange'
  | 'renditionschange'
  | 'renditionchange'
  | 'audiotrackschange'
  | 'audiotrackchange';

export interface UltraMediaCoreEvent<T = unknown> {
  type: UltraMediaCoreEventType;
  detail: T;
}

type Listener<T> = (event: UltraMediaCoreEvent<T>) => void;

/**
 * ~30-line addEventListener-compatible emitter, deliberately not
 * `extends EventTarget` - see the class doc comment above. Events here are
 * plain `{ type, detail }` objects, not real DOM Events.
 */
class Emitter {
  private listeners = new Map<string, Set<Listener<unknown>>>();

  addEventListener<T = unknown>(type: UltraMediaCoreEventType, listener: Listener<T>): void {
    let set = this.listeners.get(type);
    if (!set) {
      set = new Set();
      this.listeners.set(type, set);
    }
    set.add(listener as Listener<unknown>);
  }

  removeEventListener<T = unknown>(type: UltraMediaCoreEventType, listener: Listener<T>): void {
    this.listeners.get(type)?.delete(listener as Listener<unknown>);
  }

  protected emit<T>(type: UltraMediaCoreEventType, detail: T): void {
    const set = this.listeners.get(type);
    if (!set || set.size === 0) return;
    const event: UltraMediaCoreEvent<T> = { type, detail };
    for (const listener of [...set]) listener(event as UltraMediaCoreEvent<unknown>);
  }
}

export class UltraMediaCore extends Emitter {
  readonly media: HTMLMediaElement;

  /** Settles per load(); rejects on fatal error or if superseded by a later load(). */
  ready: Promise<void>;

  private options: UltraMediaCoreOptions;
  private player: IMediaPlayer | null = null;
  // Bumped on every load()/destroy() - lets an async callback from a
  // superseded/destroyed player's engine (e.g. hls.js's SDK still loading
  // when a later load() lands) tell it no longer applies. Moved here from
  // being duplicated ad hoc across ultra-media-element.ts and each player -
  // see docs/public-api.md and result.md "mapa do que moveu".
  private generation = 0;
  private resolveReady: () => void = () => {};
  private rejectReady: (reason: unknown) => void = () => {};

  private _src: string | null = null;
  private _format: Format | null = null;
  private _engine: string | null = null;
  private _renditions: readonly VideoRendition[] = [];
  private _rendition: string | 'auto' = 'auto';
  private _audioTracks: readonly MediaTrack[] = [];
  private _audioTrack: string | null = null;

  constructor(media: HTMLMediaElement, options: UltraMediaCoreOptions = {}) {
    super();
    if (attachedMedia.has(media)) {
      throw new Error('UltraMediaCore: media already attached to another instance - call destroy() on it first.');
    }
    attachedMedia.add(media);
    this.media = media;
    this.options = options;
    this.ready = this.freshReadyPromise();
  }

  private freshReadyPromise(): Promise<void> {
    const promise = new Promise<void>((resolve, reject) => {
      this.resolveReady = resolve;
      this.rejectReady = reject;
    });
    // Internal safety net only - marks *this* promise object as handled so
    // an app that never awaits `ready` doesn't get an unhandledrejection;
    // callers who do attach their own .then()/.catch() still see it settle.
    promise.catch(() => {});
    return promise;
  }

  get src(): string | null { return this._src; }
  get format(): Format | null { return this._format; }
  get engine(): string | null { return this._engine; }
  get renditions(): readonly VideoRendition[] { return this._renditions; }
  get audioTracks(): readonly MediaTrack[] { return this._audioTracks; }

  get rendition(): string | 'auto' { return this._rendition; }
  set rendition(id: string | 'auto') {
    this._rendition = id;
    // No built-in "resume ABR" capability exists on IMediaPlayer today
    // (switchRendition just pins an index) - 'auto' is accepted but is a
    // no-op until an engine actually supports it (see result.md "desvio").
    if (id !== 'auto') this.player?.switchRendition?.(id);
    this.emit('renditionchange', { rendition: this._rendition });
  }

  get audioTrack(): string | null { return this._audioTrack; }
  set audioTrack(id: string | null) {
    this._audioTrack = id;
    if (id != null) this.player?.switchAudioTrack?.(id);
    this.emit('audiotrackchange', { audioTrack: this._audioTrack });
  }

  /**
   * Same branching as the pre-extraction `applySrcChange`: reuse the current
   * player via its own `load()` when the format is unchanged, otherwise
   * destroy it and create a fresh one. `destroy()` (called from here on a
   * format change, or by a consumer directly) always leaves `media` clean
   * and ready for another `load()` on this same core, or a brand new core.
   */
  load(source: UltraMediaSource): void {
    const src = typeof source === 'string' ? source : source.src;
    const explicitFormat = typeof source === 'string' ? undefined : source.type;
    const newFormat = explicitFormat ?? detectFormat(src) ?? null;
    const previousEngine = this._engine;

    this.generation += 1;
    const generation = this.generation;
    this.rejectReady(new Error('UltraMediaCore: superseded by a new load()'));
    this.ready = this.freshReadyPromise();

    if (this.player && this._format !== newFormat) {
      this.teardownPlayer();
    }

    if (this.player && this._format === newFormat) {
      this.player.load(src);
    } else {
      this.player = PlayerFactory.create({
        src,
        element: this.media as HTMLVideoElement,
        container: this.options.container,
        format: newFormat ?? undefined,
      });
      // Learned directly from the same resolution PlayerFactory.create()
      // just used, not read back off the <video> - the core no longer
      // writes data-type on a <video> it doesn't own (see
      // result-cycle3.md, defect 1).
      this._engine = PlayerFactory.resolveEngine(src, undefined, newFormat ?? undefined);
    }

    this.wireUp(this.player, generation);

    this._src = src;
    this._format = newFormat;
    this.emit('sourcechange', { src: this._src });
    if (this._engine !== previousEngine) {
      this.emit('enginechange', { engine: this._engine });
    }
  }

  private wireUp(player: IMediaPlayer, generation: number): void {
    player.onReady.then(() => {
      if (generation !== this.generation) return;
      this.resolveReady();
      this.emit('ready', undefined);
    }).catch((error) => {
      if (generation !== this.generation) return;
      this.rejectReady(error);
    });

    // Single error policy for every engine, moved verbatim from
    // ultra-media-element.ts's initializePlayer(): only a fatal error
    // becomes `error`; anything recoverable becomes `warning`, same detail.
    // The generation check must gate the emit itself, not just
    // rejectReady() - an async error callback from a superseded/destroyed
    // load (e.g. player-factory.ts's CONTAINER_REQUIRED stub, deferred onto
    // a microtask, or hls.js/dash.js's own async SDK error events) must not
    // reach the host at all once its load no longer applies (see
    // result-cycle3.md, defect 3).
    player.onError?.((error: MediaPlayerError) => {
      if (generation !== this.generation) return;
      this.emit(error.fatal ? 'error' : 'warning', error);
      if (error.fatal) {
        this.rejectReady(error);
      }
    });

    player.onTracksChange?.((tracks: MediaTracks) => {
      if (generation !== this.generation) return;
      this._audioTracks = tracks.audio ?? [];
      this._renditions = tracks.renditions ?? [];
      this.emit('audiotrackschange', { audioTracks: this._audioTracks });
      this.emit('renditionschange', { renditions: this._renditions });
    });
  }

  private teardownPlayer(): void {
    this.player?.destroy();
    this.player = null;
    this._renditions = [];
    this._audioTracks = [];
    this._rendition = 'auto';
    this._audioTrack = null;
    // The core writes nothing on the host's element besides `src`. A player
    // that does (YouTubePlayer hides the native <video>) undoes its own
    // write in its destroy(), which the line above already ran.
    // A format swap or destroy() must not leave the previous engine's
    // tracks visible - the new engine (if any) may never report its own
    // (e.g. the native players don't call onTracksChange at all), so this
    // is the only place stale renditions/audioTracks otherwise get cleared.
    this.emit('audiotrackschange', { audioTracks: this._audioTracks });
    this.emit('renditionschange', { renditions: this._renditions });
  }

  /** Idempotent. Leaves `media` clean and reusable by this core or a new one. */
  destroy(): void {
    this.generation += 1;
    this.rejectReady(new Error('UltraMediaCore: destroyed'));
    this.teardownPlayer();
    this._src = null;
    this._format = null;
    this._engine = null;
    attachedMedia.delete(this.media);
  }
}
