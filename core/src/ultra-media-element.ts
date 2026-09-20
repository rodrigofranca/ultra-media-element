import type { MediaPlayerError } from './core/media-player';
import { CustomVideoElement, Events as CustomMediaEvents } from 'custom-media-element';
import { MediaTracksMixin } from 'media-tracks';
import { UltraMediaCore, type UltraMediaCoreEvent } from './core/ultra-media-core';
import { Format } from './core/format';

/**
 * Ultra Media Element supporting HLS, DASH, MP4 and MP3.
 *
 * @element ultra-media
 * @attr {string} src - Source URL for the media
 */
export class UltraMediaElement extends MediaTracksMixin(CustomVideoElement) {

  // ADR-0001: everything that used to be "orchestrate a player" now lives in
  // UltraMediaCore, instantiated once (lazily, once nativeEl/src are both
  // available) and reused for the element's whole lifetime - destroy()/load()
  // are called on it repeatedly, exactly like `this.player` used to be
  // replaced/nulled repeatedly. This class now only does "being an element":
  // owning the <video>, reflecting `src`, mirroring core state to the
  // media-tracks lists media-chrome reads, and re-dispatching error/warning.
  private core: UltraMediaCore | null = null;
  // disconnectedCallback defers its teardown to a microtask so a
  // synchronous disconnect+reconnect (an element moved in the DOM, common in
  // frameworks) doesn't tear down a still-wanted player - see
  // disconnectedCallback below and result.md "decisões de design".
  private teardownScheduled = false;
  // src the active player last loaded - lets connectedCallback catch up a
  // src change made mid-move, while attributeChangedCallback left it alone.
  private loadedSrc: string | null = null;
  // Unlike the previous base class (docs/adr/0001-headless-core-and-
  // element-shell.md, D3), custom-media-element never reads this off the
  // subclass - its own #forwardAttribute only skips an attribute that
  // isn't in *its own* observedAttributes (e.g. our 'live'); 'src' *is* in
  // that list (it's one of custom-media-element's own reflected
  // `Attributes`), so it would forward every 'src' change straight onto
  // nativeEl.setAttribute('src', ...) - firing the browser's native
  // resource-selection algorithm on the raw manifest/media URL before the
  // right engine (hls.js/dash.js/native/YouTube) ever attaches, which is
  // exactly the fetch pending-load-cancel.spec.ts's "only requests C"
  // assertions would catch. `attributeChangedCallback` below re-implements
  // the skip itself instead (see its comment) - `skipAttributes` stays a
  // real, consulted member of the contract, just enforced here now instead
  // of by the base.
  static skipAttributes = ['src'];
  // custom-media-element forwards every native HTMLMediaElement event it
  // sees on `nativeEl` (its shadow-root-level capturing listener runs
  // before any listener a player attaches directly on `nativeEl`, so it
  // can't be pre-empted there) as a same-named CustomEvent with
  // `detail: undefined`. For every event except `error` that's the whole
  // story, but VideoPlayer/AudioPlayer *also* listen for the native
  // `error` event to build a proper MediaPlayerError and route it through
  // the single fatal/warning policy below - leaving `error` in this list
  // would let that generic, detail-less forward reach listeners first,
  // ahead of (and instead of) the real shaped one. Excluding it here makes
  // the core's error routing the only source of `error`/`warning`, for
  // every engine.
  static Events = CustomMediaEvents.filter((type) => type !== 'error');
  public isLive = false;

  constructor() {
    super();
    this.setupTrackListeners();
  }

  private setupTrackListeners() {
    this.audioTracks.onchange = () => {
      const enabledTrack = [...this.audioTracks].find(track => track.enabled);
      if (enabledTrack && this.core) {
        this.core.audioTrack = enabledTrack.id;
      }
    };

    this.videoRenditions.onchange = () => {
      const selectedRendition = [...this.videoRenditions].find(rendition => rendition.selected);
      if (selectedRendition?.id && this.core) {
        this.core.rendition = selectedRendition.id;
      }
    };
  }

  connectedCallback() {
    super.connectedCallback?.();

    // Single rule for every "connect with a player that isn't running yet"
    // case, whether this is the element's very first connection (created
    // via JS, `src` assigned before insertion - attributeChangedCallback
    // deliberately did nothing while disconnected, see
    // attributeChangedCallback below) or a reconnect after an *effective*
    // teardown (disconnectedCallback's microtask actually ran destroy(),
    // which resets the core's own `src` to null - see UltraMediaCore.destroy -
    // `src` the *attribute* never changed across that disconnect, so
    // attributeChangedCallback won't fire on its own to restart playback).
    // `this.core?.src` (not `this.core` itself) is the "is a player
    // currently active" signal - the core instance is created once and
    // reused for the element's whole lifetime, so it can be non-null with
    // no active player right after destroy(). Doesn't run at all when a
    // player is already active (e.g. a synchronous disconnect+reconnect
    // move - see disconnectedCallback) with an unchanged `src` - the branch
    // below covers a `src` change made during that same move.
    if (this.core?.src == null && this.src) {
      this.applySrcChange(this.src);
      return;
    }

    // A src change made mid-move: attributeChangedCallback saw
    // `!isConnected` and left the still-alive player alone. Catch up now,
    // exactly once - a no-op when src didn't change (loadedSrc matches).
    if (this.core?.src != null && this.src !== this.loadedSrc) {
      this.applySrcChange(this.src);
    }
  }

  disconnectedCallback() {
    super.disconnectedCallback?.();

    if (this.teardownScheduled) return;
    this.teardownScheduled = true;

    queueMicrotask(() => {
      this.teardownScheduled = false;

      // Reconnected before this microtask ran (e.g. appendChild() moving
      // the element to a new parent disconnects then reconnects it
      // synchronously) - connectedCallback already ran, playback was never
      // interrupted, nothing to tear down.
      if (this.isConnected) return;

      this.destroy();
    });
  }

  /**
   * Destroys the active engine (hls.js/dash.js/YouTube/native) via the core
   * and releases its resources. Public and idempotent - safe to call
   * repeatedly, and safe to call before any core exists. Assigning `src`
   * again afterwards (even to the same value - see attributeChangedCallback)
   * re-initializes playback on the same core and resumes it.
   *
   * No public `load()` was added alongside this (unlike
   * `HTMLMediaElement.load()`) - `load` is still the native passthrough
   * method (proxies to `nativeEl.load()`, see public-contract.spec.ts), so
   * overriding it here would shadow that passthrough project-wide, not just
   * for the destroy()-reload case. (The previous base class - see
   * docs/adr/0001-headless-core-and-element-shell.md, D3 - used to give
   * `load` a second, reserved meaning of its own: a per-subclass hook it
   * auto-invoked from its own attributeChangedCallback, wiring a
   * `loadComplete`/`isLoaded` promise around it. custom-media-element drops
   * that convention entirely - see result.md "Diferenças da base" - so this
   * is now just "the passthrough method", nothing more.)
   */
  destroy(): void {
    this.core?.destroy();
  }

  static get observedAttributes() {
    // Pega os atributos do CustomVideoElement e adiciona os novos
    return [...(super.observedAttributes ?? []), 'live'];
  }

  attributeChangedCallback(attrName: string, oldValue: string, newValue: string) {
    // `src` is in `skipAttributes` - the active player (hls.js/dash.js/
    // native/YouTube) owns nativeEl.src (MSE blob URL, or the raw URL set
    // by applySrcChange below), never attribute reflection. Reading
    // `nativeEl` (not calling super.attributeChangedCallback) still runs
    // custom-media-element's lazy init (shadow root + real <video>) without
    // its own #forwardAttribute step - see the `skipAttributes` comment
    // above for why that step must never run for `src`.
    if (UltraMediaElement.skipAttributes.includes(attrName)) {
      void this.nativeEl;
    } else {
      super.attributeChangedCallback?.(attrName, oldValue, newValue);
    }

    if (attrName !== 'src') return;

    // A no-op unless something actually needs to (re)start: either the
    // value genuinely changed, or it's the exact same value being
    // reassigned onto an element with no active player - e.g.
    // `el.destroy(); el.src = el.src`, which the custom elements spec
    // still runs this callback for (setAttribute() always queues the
    // reaction, even when the new value equals the old one). Without this,
    // reassigning the same src after destroy() had no signal to react to
    // and playback stayed dead. `this.core?.src` (not `this.core` itself)
    // is the "is a player currently active" signal - see connectedCallback.
    if (oldValue === newValue && this.core?.src != null) return;

    // Disconnected: leave the core alone - `src` becomes the pending value
    // connectedCallback reads (and, mid-move, catches up) on reconnect.
    if (!this.isConnected) return;

    this.applySrcChange(newValue);
  }

  // Delegates to the core (creating it once, lazily, on first use): the
  // core itself decides whether to reuse the current engine via load() or
  // tear it down and create a new one on a format change - see
  // UltraMediaCore.load(). Records `loadedSrc` either way. An empty/removed
  // `src` (removeAttribute('src'), `el.src = ''`) mirrors the public
  // destroy() - full teardown via the core, matching `main`'s pre-extraction
  // behavior (see result-cycle2.md, defect 1) - the element stays reusable.
  private applySrcChange(src: string): void {
    if (!this.nativeEl) {
      console.warn('[Ultra Media Element] nativeEl not available yet');
      return;
    }

    if (!src) {
      this.core?.destroy();
    } else {
      if (!this.core) this.core = this.createCore();
      this.core.load(src);
    }

    this.loadedSrc = src;
  }

  private createCore(): UltraMediaCore {
    // The shadow root, not `this` - keeps the YouTube iframe out of the
    // element's observable light DOM (el.children, page CSS/selectors,
    // conflicts with slotted <track>s) while landing in the exact same
    // visual spot as before: sibling to <video> inside the shadow tree
    // (see result-cycle2.md, defect 2). Falls back to `this` only for a
    // shadow-DOM-less test double - by the time nativeEl exists,
    // custom-media-element has always already attached a real shadow root.
    const core = new UltraMediaCore(this.nativeEl, { container: this.shadowRoot ?? this });

    core.addEventListener<MediaPlayerError>('error', (event) => this.forwardCoreEvent('error', event));
    core.addEventListener<MediaPlayerError>('warning', (event) => this.forwardCoreEvent('warning', event));
    // renditionschange always fires together with audiotrackschange, in the
    // same core.load()'s onTracksChange report (see UltraMediaCore.wireUp) -
    // resyncing from the core's current, already-up-to-date lists on either
    // one is enough; listening to just this one avoids doing it twice.
    core.addEventListener('renditionschange', () => this.syncMediaTracks());

    return core;
  }

  private forwardCoreEvent(type: 'error' | 'warning', event: UltraMediaCoreEvent<MediaPlayerError>): void {
    this.dispatchEvent(new CustomEvent(type, {
      bubbles: true,
      composed: true,
      detail: event.detail,
    }));
  }

  // Mirrors the core's neutral audioTracks/renditions arrays onto the
  // media-tracks lists media-chrome and other consumers read - moved
  // verbatim from the old initializePlayer()'s onTracksChange handler.
  private syncMediaTracks(): void {
    if (!this.core) return;

    this.removeAllMediaTracks();

    for (const track of this.core.audioTracks) {
      const audioTrack = this.addAudioTrack(track.kind || 'main', track.label, track.language);
      audioTrack.id = track.id;
      if (track.default) {
        audioTrack.enabled = true;
      }
    }

    if (this.core.renditions.length) {
      const videoTrack = this.addVideoTrack('main');
      videoTrack.id = 'main';
      videoTrack.selected = true;

      for (const rendition of this.core.renditions) {
        const videoRendition = videoTrack.addRendition(
          '',
          rendition.width,
          rendition.height,
          rendition.codec,
          rendition.bitrate,
          rendition.frameRate
        );
        videoRendition.id = rendition.id;
      }
    }
  }

  private removeAllMediaTracks() {
    for (const audioTrack of this.audioTracks) {
      this.removeAudioTrack(audioTrack);
    }
    for (const videoTrack of this.videoTracks) {
      this.removeVideoTrack(videoTrack);
    }
  }

  async changeSource(newSrc: string) {
    if (!newSrc) {
      console.warn('[Ultra Media Element] Invalid source');
      return;
    }

    this.setAttribute('src', newSrc);
  }

  // Sourced from the core's own state (reset to null by destroy()), not
  // nativeEl.dataset.type - that attribute is a PlayerFactory implementation
  // detail the core itself now cleans up on teardown, not a place to read
  // the active format back from (see result-cycle2.md, defect 4).
  getCurrentFormat(): Format | undefined {
    return this.core?.format ?? undefined;
  }
}
