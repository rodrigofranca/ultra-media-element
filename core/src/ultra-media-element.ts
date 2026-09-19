import type { IMediaPlayer, MediaTracks, MediaPlayerError } from './core/media-player';
import { SuperVideoElement, Events as SuperMediaEvents } from 'super-media-element';
import { MediaTracksMixin } from 'media-tracks';
import { getCurrentFormatFromElement, PlayerFactory } from './core/player-factory';
import { Format } from './core/format';
import { detectFormat } from './core/format-detector';

/**
 * Ultra Media Element supporting HLS, DASH, MP4 and MP3.
 *
 * @element ultra-media
 * @attr {string} src - Source URL for the media
 */
export class UltraMediaElement extends MediaTracksMixin(SuperVideoElement) {

  private player: IMediaPlayer | null = null;
  // disconnectedCallback defers its teardown to a microtask so a
  // synchronous disconnect+reconnect (an element moved in the DOM, common in
  // frameworks) doesn't tear down a still-wanted player - see
  // disconnectedCallback below and result.md "decisões de design".
  private teardownScheduled = false;
  static skipAttributes = ['src'];
  // super-media-element forwards every native HTMLMediaElement event it
  // sees on `nativeEl` (its shadow-root-level capturing listener runs
  // before any listener a player attaches directly on `nativeEl`, so it
  // can't be pre-empted there) as a same-named CustomEvent with
  // `detail: undefined`. For every event except `error` that's the whole
  // story, but VideoPlayer/AudioPlayer *also* listen for the native
  // `error` event to build a proper MediaPlayerError and route it through
  // the single fatal/warning policy below - leaving `error` in this list
  // would let that generic, detail-less forward reach listeners first,
  // ahead of (and instead of) the real shaped one. Excluding it here makes
  // player.onError() the only source of `error`/`warning`, for every engine.
  static Events = SuperMediaEvents.filter((type) => type !== 'error');
  public isLive = false;
  public declare loadComplete?: Promise<void>;
  public declare isLoaded: boolean;

  constructor() {
    super();
    this.setupTrackListeners();
  }

  private setupTrackListeners() {
    this.audioTracks.onchange = () => {
      const enabledTrack = [...this.audioTracks].find(track => track.enabled);
      if (enabledTrack && this.player?.switchAudioTrack) {
        this.player.switchAudioTrack(enabledTrack.id);
      }
    };

    this.videoRenditions.onchange = () => {
      const selectedRendition = [...this.videoRenditions].find(rendition => rendition.selected);
      if (selectedRendition?.id && this.player?.switchRendition) {
        this.player.switchRendition(selectedRendition.id);
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
    // teardown (disconnectedCallback's microtask actually ran destroy() -
    // `src` never changed across that disconnect, so
    // attributeChangedCallback won't fire on its own to restart playback).
    // Doesn't run at all when a player is already active (e.g. a
    // synchronous disconnect+reconnect move - see disconnectedCallback).
    if (!this.player && this.src) {
      this.initializePlayer();
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
   * Destroys the active player (hls.js/dash.js/YouTube/native) and releases
   * its resources. Public and idempotent - safe to call repeatedly, and
   * safe to call before any player exists. Assigning `src` again afterwards
   * (even to the same value - see attributeChangedCallback) re-initializes a
   * fresh player and resumes playback.
   *
   * No public `load()` was added alongside this (unlike
   * `HTMLMediaElement.load()`) - see result.md "decisões de design":
   * super-media-element's own SuperMedia base gives `load` a reserved,
   * different meaning (a per-subclass hook it detects via
   * `this.load !== SuperMedia.prototype.load` and auto-invokes from ITS
   * OWN attributeChangedCallback on every `src` change, wiring up its own
   * `loadComplete`/`isLoaded` promise around it). Overriding it here would
   * make the base class start calling it a second time on top of this
   * class's own src-handling below - a behavior change to every `src`
   * mutation project-wide, not just the destroy()-reload case, and out of
   * this task's scope to take on.
   */
  destroy(): void {
    this.player?.destroy?.();
    this.player = null;
  }

  static get observedAttributes() {
    // Pega os atributos do SuperVideoElement e adiciona os novos
    return [...(super.observedAttributes ?? []), 'live'];
  }

  async attributeChangedCallback(attrName: string, oldValue: string, newValue: string) {
    super.attributeChangedCallback?.(attrName, oldValue, newValue);

    if (attrName !== 'src') return;

    // A no-op unless something actually needs to (re)start: either the
    // value genuinely changed, or it's the exact same value being
    // reassigned onto an element with no active player - e.g.
    // `el.destroy(); el.src = el.src`, which the custom elements spec
    // still runs this callback for (setAttribute() always queues the
    // reaction, even when the new value equals the old one). Without this,
    // reassigning the same src after destroy() had no signal to react to
    // and playback stayed dead.
    if (oldValue === newValue && this.player) return;

    if (this.loadComplete && !this.isLoaded) {
      await this.loadComplete;
    }

    // Disconnected: leave the player alone (there shouldn't be one - see
    // connectedCallback). `src` just becomes the pending value connect()
    // reads whenever it next connects, whether this is the element's first
    // connection or a reconnect after an effective teardown.
    if (!this.isConnected) return;

    const currentFormat = this.getCurrentFormat();
    const newFormat = detectFormat(newValue ?? '');

    if (currentFormat !== newFormat) {
      this.destroy();
    }

    if (this.player && currentFormat === newFormat) {
      this.player.load(newValue);
    } else {
      this.initializePlayer();
    }
  }

  private initializePlayer() {
    if (!this.nativeEl || !this.src) {
      console.warn('[Ultra Media Element] nativeEl or src not available yet');
      return;
    }

    this.player = PlayerFactory.create({
      src: this.src,
      element: this.nativeEl,
      container: this,
    });

    // Single error policy for every engine: only a fatal error (playback
    // cannot continue without intervention) becomes the element's `error`
    // event; anything recoverable becomes `warning`, same detail shape.
    // Deciding this once, centrally, from `error.fatal` keeps engines from
    // each re-implementing (and inevitably drifting on) the same routing.
    this.player.onError?.((error: MediaPlayerError) => {
      this.dispatchEvent(new CustomEvent(error.fatal ? 'error' : 'warning', {
        bubbles: true,
        composed: true,
        detail: error,
      }));
    });

    // Registra os eventos de tracks
    this.player.onTracksChange?.((tracks: MediaTracks) => {
      this.removeAllMediaTracks();

      if (tracks.audio) {
        tracks.audio.forEach((track) => {
          const audioTrack = this.addAudioTrack(track.kind || 'main', track.label, track.language);
          audioTrack.id = track.id;
          if (track.default) {
            audioTrack.enabled = true;
          }
        });
      }

      if (tracks.renditions) {
        const videoTrack = this.addVideoTrack('main');
        videoTrack.id = 'main';
        videoTrack.selected = true;

        tracks.renditions.forEach((rendition) => {
          const videoRendition = videoTrack.addRendition(
            '',
            rendition.width,
            rendition.height,
            rendition.codec,
            rendition.bitrate,
            rendition.frameRate
          );
          videoRendition.id = rendition.id;
        });
      }
    });
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

  getCurrentFormat(): Format | undefined {
    return this.nativeEl ? getCurrentFormatFromElement(this.nativeEl) : undefined;
  }
}
