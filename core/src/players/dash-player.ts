import type { IMediaPlayer, MediaTracks, MediaPlayerError, MediaErrorCategory } from "../core/media-player";
import type { RequestContext, RequestPolicy } from "../core/request-policy";
import { applyRequestPolicy } from "../core/apply-request-policy";
import { log } from "../utils/log";
import { loadSDK } from "../utils/network";
import { isUndefined } from "../utils/unit";
import { DASHJS_SDK_URL } from "../core/sdk-config";
import { mapNativeMediaError } from "./native-media-error";

// dash.js's internal HTTPRequest.type string constants
// (dist/modern/umd/dash.all.debug.js - MPD_TYPE='MPD',
// MEDIA_SEGMENT_TYPE='MediaSegment', etc.), surfaced on
// `request.customData.request.type` inside addRequestInterceptor - not part
// of the public index.d.ts types (@svta/cml-request's CommonMediaRequest),
// confirmed by reading the debug bundle (ADR-0001 D4).
const DASH_SEGMENT_TYPES = new Set(['MediaSegment', 'InitializationSegment', 'IndexSegment', 'BitstreamSwitchingSegment', 'FragmentInfoSegment']);
function classifyDashRequestType(type: string | undefined): RequestContext['type'] {
  if (type === 'MPD') return 'manifest';
  if (type === 'license' || type === 'licenseCertificate') return 'license';
  if (type && DASH_SEGMENT_TYPES.has(type)) return 'segment';
  return 'other';
}

// dash.js reports every error through one event carrying a numeric
// `MediaPlayer.errors` code (see node_modules/dashjs/index.d.ts
// `MediaPlayerErrors`) and never sets a `fatal` flag itself - unlike
// hls.js, severity has to be inferred from the code. These two tables
// encode that policy; see result.md "decisões de design" for the
// per-code reasoning (manifest/MSE failures are fatal, a single
// segment/init/sidx/timing resource failing is not - dash.js's own
// retry/ABR logic can route around it, confirmed by reading
// dist/modern/umd/dash.all.debug.js's HTTPLoader and ErrorHandler).
function categorizeDashError(code: number | null, errors: any): MediaErrorCategory {
  if (code == null) return 'otherError';

  const mediaErrorCodes = [
    errors.APPEND_ERROR_CODE,
    errors.REMOVE_ERROR_CODE,
    errors.DATA_UPDATE_FAILED_ERROR_CODE,
    errors.CAPABILITY_MEDIASOURCE_ERROR_CODE,
    errors.CAPABILITY_MEDIAKEYS_ERROR_CODE,
    errors.MEDIASOURCE_TYPE_UNSUPPORTED_CODE,
  ];
  if (mediaErrorCodes.includes(code)) return 'mediaError';

  const networkErrorCodes = [
    errors.MANIFEST_LOADER_PARSING_FAILURE_ERROR_CODE,
    errors.MANIFEST_LOADER_LOADING_FAILURE_ERROR_CODE,
    errors.XLINK_LOADER_LOADING_FAILURE_ERROR_CODE,
    errors.SEGMENT_BASE_LOADER_ERROR_CODE,
    errors.TIME_SYNC_FAILED_ERROR_CODE,
    errors.FRAGMENT_LOADER_LOADING_FAILURE_ERROR_CODE,
    errors.FRAGMENT_LOADER_NULL_REQUEST_ERROR_CODE,
    errors.URL_RESOLUTION_FAILED_GENERIC_ERROR_CODE,
    errors.DOWNLOAD_ERROR_ID_MANIFEST_CODE,
    errors.DOWNLOAD_ERROR_ID_SIDX_CODE,
    errors.DOWNLOAD_ERROR_ID_CONTENT_CODE,
    errors.DOWNLOAD_ERROR_ID_INITIALIZATION_CODE,
    errors.DOWNLOAD_ERROR_ID_XLINK_CODE,
    errors.MANIFEST_ERROR_ID_PARSE_CODE,
    errors.MANIFEST_ERROR_ID_NOSTREAMS_CODE,
    errors.MANIFEST_ERROR_ID_MULTIPLEXED_CODE,
  ];
  if (networkErrorCodes.includes(code)) return 'networkError';

  return 'otherError';
}

// Codes for a single resource that dash.js's own retry/ABR machinery can
// route around without stopping playback. Anything not in this list
// (manifest/MSE/capability failures, and any code dash.js adds in the
// future) defaults to fatal.
//
// DOWNLOAD_ERROR_ID_SIDX_CODE/CONTENT_CODE/INITIALIZATION_CODE (26/27/28)
// are deliberately NOT here, unlike the other single-resource codes: dash.js
// only raises them through HTTPLoader's `_retriggerRequest` once its own
// internal retry budget (mediaPlayerModel.getRetryAttemptsForType) is
// already exhausted (node_modules/dashjs/dist/modern/umd/dash.all.debug.js
// ~60075-60102, `downloadErrorToRequestTypeMap` ~59856-59863) - by the time
// this event reaches us, dash.js itself has given up on that
// segment/init-segment/sidx and playback is stalled, not routing around it.
// The other codes below (SEGMENT_BASE_LOADER, TIME_SYNC, FRAGMENT_LOADER,
// URL_RESOLUTION, TIMED_TEXT parse) come from different, single-shot code
// paths with no such exhausted-retry precondition, so they keep their
// original recoverable classification.
function isDashErrorRecoverable(code: number | null, errors: any): boolean {
  if (code == null) return false;

  return [
    errors.SEGMENT_BASE_LOADER_ERROR_CODE,
    errors.TIME_SYNC_FAILED_ERROR_CODE,
    errors.FRAGMENT_LOADER_LOADING_FAILURE_ERROR_CODE,
    errors.FRAGMENT_LOADER_NULL_REQUEST_ERROR_CODE,
    errors.URL_RESOLUTION_FAILED_GENERIC_ERROR_CODE,
    errors.TIMED_TEXT_ERROR_ID_PARSE_CODE,
  ].includes(code);
}

export class DashPlayer implements IMediaPlayer {
  private nativeEl: HTMLVideoElement;
  public onReady: Promise<void>;
  private dashjs: any;
  private player: any;
  private sdkSrc: string = DASHJS_SDK_URL;
  private config = {
    streaming: {
      abr: {
        autoSwitchBitrate: {
          audio: true,
          video: true
        }
      }
    }
  };
  private tracksChangeCallback?: (tracks: MediaTracks) => void;
  private errorCallback?: (error: MediaPlayerError) => void;
  private audioTracks: any[] = [];
  private videoRepresentations: any[] = [];
  // Same cancellation guard as HlsPlayer (see its comments) - checked right
  // after `loadSDK()` resolves, before `this.dashjs.MediaPlayer().create()`,
  // so destroy() during the CDN script load stops a dash.js instance from
  // ever being created instead of creating and orphaning one.
  private destroyed = false;
  // Last requested src; queued the same way as HlsPlayer's when `load()` is
  // called before `this.player` exists yet.
  private pendingSrc?: string;
  private nativeErrorHandler?: () => void;
  // Read live by the addRequestInterceptor callback below at request time -
  // see HlsPlayer's `requestPolicy` field comment for why (ADR-0001 D4).
  private requestPolicy?: RequestPolicy;
  private requestInterceptor?: (request: any) => Promise<any>;
  // ADR-0001 D5 - see hls-player.ts's equivalent fields' comment.
  private liveCallback?: (isLive: boolean, playheadDate: Date | null) => void;
  private streamEndedCallback?: () => void;
  private wasLive = false;

  constructor(private element: HTMLVideoElement, requestPolicy?: RequestPolicy, private liveOpt?: boolean | 'auto') {
    log("Powered by Dash.js");
    this.nativeEl = element;
    this.requestPolicy = requestPolicy;
    this.onReady = new Promise((resolve, reject) => {
      this.setup().then(resolve).catch(reject);
    });
  }

  private async setup() {
    if (isUndefined(this.dashjs)) {
      this.dashjs = await loadSDK(this.sdkSrc, 'dashjs');
    }

    if (this.destroyed) return;

    this.player = this.dashjs.MediaPlayer().create();
    this.player.initialize(this.nativeEl, null, true);
    this.player.updateSettings(this.config);

    // The most stable request hook in dash.js 5.x (ADR-0001 D4): a single
    // interceptor covers manifest/segment/license requests alike, unlike
    // per-type credential settings. `request` is the SDK's own
    // CommonMediaRequest object - `applyRequestPolicy` mutates its
    // url/headers in place; `credentials` is set directly here since dash.js
    // reads that field with the exact same 'omit'|'same-origin'|'include'
    // values RequestPolicy uses.
    this.requestInterceptor = (request: any) => {
      const ctx: RequestContext = { url: request.url, type: classifyDashRequestType(request.customData?.request?.type), engine: 'dash.js' };
      const ok = applyRequestPolicy(this.requestPolicy, ctx, request, (err) => this.errorCallback?.(err));
      if (ok && this.requestPolicy?.credentials) request.credentials = this.requestPolicy.credentials; // defect 4
      return Promise.resolve(request);
    };
    this.player.addRequestInterceptor(this.requestInterceptor);

    this.player.on(this.dashjs.MediaPlayer.events.ERROR, (e: any) => {
      if (this.errorCallback) {
        const err = e.error ?? {};
        const code: number | null = typeof err.code === 'number' ? err.code : null;

        // dash.js re-emits a native <video> MediaError through this same
        // ERROR event once it gives up on it (its own PlaybackController
        // `_onPlaybackError`, dash.all.debug.js ~51630-51672, notably with
        // its own bounded silent-retry for MEDIA_ERR_DECODE first) - using
        // the *native* MediaError code (1-5) as `err.code`, a range our own
        // MediaPlayerErrors-based codes (10+) never use. The dedicated
        // nativeEl 'error' listener below already reports those, in the
        // same shape every other engine uses (native-media-error.ts) - skip
        // them here so the same failure isn't reported twice.
        if (code != null && code >= 1 && code <= 5) return;

        const data = err.data ?? {};
        const errors = this.dashjs.MediaPlayer.errors;
        this.errorCallback({
          fatal: !isDashErrorRecoverable(code, errors),
          category: categorizeDashError(code, errors),
          code: code != null ? String(code) : 'unknown',
          message: err.message || 'unknown',
          engine: 'dash.js',
          url: data.response?.url ?? data.request?.url,
          status: data.response?.status,
          cause: err,
        });
      }
    });

    this.player.on(this.dashjs.MediaPlayer.events.STREAM_INITIALIZED, () => {
      if (this.tracksChangeCallback) {
        const audioTracks = this.player.getTracksFor('audio');
        // One entry per bitrate Representation of the current video
        // MediaInfo - not one per AdaptationSet like getTracksFor('video')
        // returns (see result.md "decisões de design" - confirmed by
        // reading Stream#getRepresentationsByType in
        // dist/modern/umd/dash.all.debug.js). Indices here line up 1:1
        // with setRepresentationForTypeByIndex, which reads from the same
        // underlying list, so manual rendition selection keeps working.
        const videoRepresentations = this.player.getRepresentationsByType('video');
        this.audioTracks = audioTracks;
        this.videoRepresentations = videoRepresentations;

        const tracks: MediaTracks = {
          audio: audioTracks?.map((track: any, index: number) => ({
            id: `${index}`,
            kind: track.roles?.includes('main') ? 'main' : 'alternative',
            label: track.lang || `Audio ${index + 1}`,
            language: track.lang,
            default: track.roles?.includes('main')
          })),
          renditions: videoRepresentations?.map((representation: any, index: number) => ({
            id: `${index}`,
            width: representation.width,
            height: representation.height,
            bitrate: representation.bandwidth,
            frameRate: representation.frameRate,
            codec: representation.codecs
          }))
        };
        this.tracksChangeCallback(tracks);
      }
      reportLive();
    });

    // ADR-0001 D5 - PLAYBACK_TIME_UPDATED (public event, fires on every
    // native timeupdate-equivalent tick) recomputes isLive/playheadDate
    // continuously during playback - deliberately *not* MANIFEST_LOADED/
    // MANIFEST_UPDATED: dash.js's own periodic dynamic-MPD reload
    // (ManifestUpdater's minimumUpdatePeriod timer) was confirmed, by
    // reading dist/modern/umd/dash.all.debug.js and by direct observation
    // against this package's fixture, to not reliably fire on every version/
    // setup - tying live-info freshness to it left `core.live` stale for
    // long stretches. PLAYBACK_TIME_UPDATED has no such dependency.
    // DYNAMIC_TO_STATIC is dash.js's own direct signal for "this MPD just
    // stopped being live" - the ENDLIST-equivalent - but wasn't observed to
    // fire on a source reattach (attachSource() resets the manifest model
    // dash.js compares old/new `type` against internally, in `_update()`) -
    // confirmed empirically against this harness (see result.md "fixture
    // live"). So the transition is *also* (primarily, in practice) caught
    // the same way hls-player.ts's LEVEL_LOADED does it: comparing this
    // tick's isDynamic() against the last one, inside reportLive() itself -
    // both share the `wasLive` guard, so whichever fires first wins and the
    // other becomes a no-op (never double-fires).
    const reportLive = () => {
      if (this.liveOpt === false) return;
      const dynamicLive = this.player.isDynamic();
      if (this.wasLive && !dynamicLive) this.streamEndedCallback?.();
      this.wasLive = dynamicLive;
      this.liveCallback?.(this.liveOpt === true || dynamicLive, dynamicLive ? new Date(this.player.timeAsUTC() * 1000) : null);
    };
    this.player.on(this.dashjs.MediaPlayer.events.PLAYBACK_TIME_UPDATED, reportLive);
    this.player.on(this.dashjs.MediaPlayer.events.DYNAMIC_TO_STATIC, () => {
      if (!this.wasLive) return;
      this.wasLive = false;
      this.streamEndedCallback?.();
    });

    // Belt-and-suspenders alongside dash.js's own native-error forwarding
    // above: reports every native <video> `error` through the same shared
    // mapper every other engine uses (native-media-error.ts), independent
    // of dash.js's internal wiring. Removed in destroy() before dash.js
    // tears its own attachment down, so teardown itself can't trigger this.
    this.nativeErrorHandler = () => {
      // No MediaError = a stale event for a source a newer load superseded
      // (the load algorithm resets `error` to null) - not this load's.
      if (this.errorCallback && this.nativeEl.error) {
        this.errorCallback(mapNativeMediaError(this.nativeEl.error, 'dash.js', this.pendingSrc ?? this.nativeEl.currentSrc));
      }
    };
    this.nativeEl.addEventListener('error', this.nativeErrorHandler);

    if (this.pendingSrc) {
      this.applyLoad(this.pendingSrc);
    }
  }

  private applyLoad(src: string) {
    this.player.attachSource(src);
  }

  onTracksChange(callback: (tracks: MediaTracks) => void) {
    this.tracksChangeCallback = callback;
  }

  onError(callback: (error: MediaPlayerError) => void) {
    this.errorCallback = callback;
  }

  switchAudioTrack(trackId: string) {
    if (!this.player || !this.audioTracks) return;
    const audioTrackId = parseInt(trackId, 10);
    if (!isNaN(audioTrackId) && this.audioTracks[audioTrackId]) {
      this.player.setCurrentTrack(this.audioTracks[audioTrackId]);
    }
  }

  switchRendition(renditionId: string) {
    if (!this.player || !this.videoRepresentations) return;
    const index = parseInt(renditionId, 10);
    if (!isNaN(index) && this.videoRepresentations[index]) {
      this.player.setRepresentationForTypeByIndex('video', index);
    }
  }

  onLiveChange(callback: (isLive: boolean, playheadDate: Date | null) => void) {
    this.liveCallback = callback;
  }

  onStreamEnded(callback: () => void) {
    this.streamEndedCallback = callback;
  }

  /** dash.js's own edge-seek - no-op if not currently live/not ready (ADR-0001 D5). */
  goToLive(): void {
    if (this.wasLive) this.player?.seekToOriginalLive?.();
  }

  load(src: string, requestPolicy?: RequestPolicy) {
    this.pendingSrc = src;
    this.requestPolicy = requestPolicy;
    this.wasLive = false;
    if (this.destroyed || !this.player) return;
    this.applyLoad(src);
  }

  destroy() {
    this.destroyed = true;

    if (this.nativeErrorHandler) {
      this.nativeEl.removeEventListener('error', this.nativeErrorHandler);
      this.nativeErrorHandler = undefined;
    }

    if (this.player) {
      if (this.requestInterceptor) {
        this.player.removeRequestInterceptor(this.requestInterceptor);
        this.requestInterceptor = undefined;
      }
      this.player.destroy();
      this.player = null;
    }
  }
}