import type { IMediaPlayer, MediaTracks, MediaPlayerError, VideoRendition, MediaTrack, LiveInfo } from './media-player';
import type { RequestPolicy } from './request-policy';
import { PlayerFactory } from './player-factory';
import { Format } from './format';
import { detectFormat } from './format-detector';
import { normalizeLiveDate } from './live-date';

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
  /**
   * Auth headers/credentials/URL rewriting applied to every engine's
   * requests where technically possible (ADR-0001 D4). Set at construction
   * or via configure() - configure() only takes effect starting with the
   * next load(); an in-progress load()'s own requests keep whatever policy
   * was active when that load() ran.
   */
  request?: RequestPolicy;
  /**
   * ADR-0001 D5 - default 'auto': isLive comes from the manifest. `true`
   * forces live handling (start-at-edge is the engine SDK's own default
   * behavior for a live manifest, already unconditional - see
   * result.md "por que goToLive()/borda inicial não têm código próprio");
   * `false` forces VOD treatment regardless of what the manifest/engine
   * reports. Read once at player construction, like `container` - a later
   * configure({ live }) only applies starting with the next load().
   */
  live?: boolean | 'auto';
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
  | 'audiotrackchange'
  | 'livechange'
  | 'streamended';

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

// result-cycle2.md, defect 8 - `liveEdge`/`dvr` are derived from a
// per-engine "distance from seekableEnd to the normal live-sync position"
// (`liveEdgeOffsetSeconds`, reported by onLiveChange). Used as a fallback
// only before any engine has reported one yet (matches the historic flat
// 30s dvr threshold: 2x15 = 30).
const DEFAULT_LIVE_EDGE_OFFSET_SECONDS = 15;
// dvr is true once the seekable window is significantly larger than the
// normal distance to the edge (> 2x that distance), with a floor so a
// tiny/zero live-edge-offset (e.g. a manifest with no holdBack/target
// latency configured) doesn't call a barely-larger-than-instantaneous
// window "dvr".
const DVR_DISTANCE_MULTIPLIER = 2;
const DVR_FLOOR_SECONDS = 30;
// result-cycle2.md, defect 7 - `livechange` only fires when isLive/dvr/the
// seekable window changes by at least this much; smaller deltas (playback
// ticks) don't fire it. playheadDate/latency are excluded from this
// comparison entirely - see the `live` getter below.
const WINDOW_GRANULARITY_SECONDS = 1;

interface LiveWindowState {
  readonly isLive: boolean;
  readonly seekableStart: number;
  readonly seekableEnd: number;
  readonly liveEdge: number;
  readonly dvr: boolean;
}

const NEUTRAL_WINDOW: LiveWindowState = Object.freeze({ isLive: false, seekableStart: 0, seekableEnd: 0, liveEdge: 0, dvr: false });

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
  // result-cycle2.md, defect 7 - only the "stable" window fields live here;
  // playheadDate/latency are derived fresh on every `live` read from
  // `_playheadRef` below (see the `live` getter).
  private _liveWindow: LiveWindowState = NEUTRAL_WINDOW;
  // Last engine-reported (playheadDate, media.currentTime-at-that-report)
  // pair. `live`'s getter extrapolates from it using how far `currentTime`
  // has moved since, instead of needing a fresh event for every read
  // (result-cycle2.md, defect 7) - same linear assumption
  // native-live.ts's own formula already makes (wallclock advances with
  // currentTime while genuinely playing).
  private _playheadRef: { date: Date; mediaTime: number } | null = null;

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
   * A fresh, frozen snapshot on every read (result-cycle2.md, defect 3) -
   * `isLive`/`seekableStart`/`seekableEnd`/`liveEdge`/`dvr` come from the
   * last relevant engine report (`_liveWindow`); `playheadDate`/`latency`
   * are recomputed right now from `_playheadRef` + `media.currentTime`
   * (defect 7) - never stale, never shared with a previous snapshot.
   */
  get live(): LiveInfo {
    return Object.freeze({
      ...this._liveWindow,
      playheadDate: this.computePlayheadDate(),
      latency: this._liveWindow.isLive ? Math.max(0, this._liveWindow.liveEdge - this.media.currentTime) : undefined,
    });
  }

  /** No-op (silently) when the current engine isn't live, or has none. */
  goToLive(): void { this.player?.goToLive?.(); }

  private computePlayheadDate(): Date | null {
    if (!this._playheadRef) return null;
    const elapsedMs = (this.media.currentTime - this._playheadRef.mediaTime) * 1000;
    return normalizeLiveDate(new Date(this._playheadRef.date.getTime() + elapsedMs));
  }

  private computeWindow(isLive: boolean, liveEdgeOffsetSeconds: number | undefined): LiveWindowState {
    const seekable = this.media.seekable;
    const len = seekable.length;
    const seekableStart = len ? seekable.start(0) : 0;
    const seekableEnd = len ? seekable.end(len - 1) : 0;
    // result-cycle2.md, defect 8 - proportional to the engine's own normal
    // distance from the edge instead of a flat threshold; falls back to a
    // documented default before any engine has reported an offset yet.
    const offset = liveEdgeOffsetSeconds ?? DEFAULT_LIVE_EDGE_OFFSET_SECONDS;
    const liveEdge = isLive ? Math.max(seekableStart, seekableEnd - offset) : seekableEnd;
    const dvr = isLive && (seekableEnd - seekableStart) > Math.max(DVR_FLOOR_SECONDS, DVR_DISTANCE_MULTIPLIER * offset);
    return { isLive, seekableStart, seekableEnd, liveEdge, dvr };
  }

  /** result-cycle2.md, defect 7 - the only gate on whether `livechange` fires. */
  private isRelevantLiveChange(next: LiveWindowState): boolean {
    const prev = this._liveWindow;
    return (
      next.isLive !== prev.isLive ||
      next.dvr !== prev.dvr ||
      Math.abs(next.seekableStart - prev.seekableStart) >= WINDOW_GRANULARITY_SECONDS ||
      Math.abs(next.seekableEnd - prev.seekableEnd) >= WINDOW_GRANULARITY_SECONDS ||
      Math.abs(next.liveEdge - prev.liveEdge) >= WINDOW_GRANULARITY_SECONDS
    );
  }

  /**
   * Resets live state to neutral - called at the very start of every
   * load() (result-cycle2.md, defect 2: a same-format reused engine's
   * previous live state must not survive into the new source) and from
   * teardownPlayer() (format change / destroy()). Idempotent: emits
   * `livechange` only if something was actually live/non-neutral.
   */
  private resetLive(): void {
    const changed = this.isRelevantLiveChange(NEUTRAL_WINDOW);
    this._liveWindow = NEUTRAL_WINDOW;
    this._playheadRef = null;
    if (changed) this.emit('livechange', this.live);
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
    // result-cycle2.md, defect 2 - every load() starts from neutral live
    // state, whether or not the engine is reused; the (possibly reused)
    // player's own next onLiveChange report is what re-establishes it.
    this.resetLive();

    if (this.player && this._format !== newFormat) {
      this.teardownPlayer();
    }

    if (this.player && this._format === newFormat) {
      // `this.options.live` (result-cycle2.md, defect 4): like `request`,
      // reaches a reused engine starting with this load() - not just at
      // construction time.
      this.player.load(src, this.options.request, this.options.live);
    } else {
      this.player = PlayerFactory.create({
        src,
        element: this.media as HTMLVideoElement,
        container: this.options.container,
        format: newFormat ?? undefined,
        requestPolicy: this.options.request,
        live: this.options.live,
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

    player.onLiveChange?.((isLive: boolean, playheadDate: Date | null, liveEdgeOffsetSeconds?: number) => {
      if (generation !== this.generation) return;
      // On-demand fields' reference point always updates - only the
      // "stable" window fields (and whether `livechange` fires) go through
      // the relevance gate (result-cycle2.md, defect 7).
      this._playheadRef = playheadDate ? { date: new Date(playheadDate.getTime()), mediaTime: this.media.currentTime } : null;
      const next = this.computeWindow(isLive, liveEdgeOffsetSeconds);
      if (this.isRelevantLiveChange(next)) {
        this._liveWindow = next;
        this.emit('livechange', this.live);
      }
    });

    player.onStreamEnded?.(() => {
      if (generation !== this.generation) return;
      this._playheadRef = null;
      this._liveWindow = this.computeWindow(false, undefined);
      this.emit('livechange', this.live);
      this.emit('streamended', undefined);
    });
  }

  private teardownPlayer(): void {
    this.player?.destroy();
    this.player = null;
    this._renditions = [];
    this._audioTracks = [];
    this._rendition = 'auto';
    this._audioTrack = null;
    this.resetLive();
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

  /**
   * Merges into this core's options (today only `request` is meaningful
   * here - `container` is only ever read at construction). Takes effect
   * starting with the next load() call - see UltraMediaCoreOptions.request.
   */
  configure(options: Partial<UltraMediaCoreOptions>): void {
    this.options = { ...this.options, ...options };
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
