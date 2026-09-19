/**
 * Central place for third-party SDK versions/URLs loaded dynamically at
 * runtime. Always pin an exact version here — an unpinned/"latest" CDN build
 * can change under production traffic without a corresponding release here.
 *
 * The YouTube IFrame API and Google's IMA3 SDK (loaded by the `ima-ad-player`
 * dependency) are intentionally not listed: neither is offered by Google as a
 * versioned/pinned URL, so there is nothing to fix here for them. See
 * result.md "Descobertas".
 */

export const HLS_JS_VERSION = "1.7.3";
export const DASHJS_VERSION = "5.2.1";

export const HLS_JS_SDK_URL = `https://cdn.jsdelivr.net/npm/hls.js@${HLS_JS_VERSION}/dist/hls.min.js`;
export const DASHJS_SDK_URL = `https://cdn.jsdelivr.net/npm/dashjs@${DASHJS_VERSION}/dist/modern/umd/dash.all.min.js`;

export const YOUTUBE_IFRAME_API_URL = "https://www.youtube.com/iframe_api";
