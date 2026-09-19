import { test, expect } from '../utils/hermetic';
import { gotoPlayer, setSrc, instrument, getLog, callMethod, getProp } from '../utils/media';

// Freezes the part of <ultra-media>'s effective public API (ADR-0001, Fase 1)
// that jsdom can't reliably exercise: what super-media-element's real
// nativeElProps passthrough actually installs from the real HTMLVideoElement
// prototype, and attribute<->property reflection, both of which depend on
// the real `super-media-element` package (ESM-only, not part of Jest's
// transform pipeline - see docs/public-api.md "Método de inventário").
// Runs against the published dist/ultra-media.es.js, like every other
// hermetic e2e spec, via the shared player.html harness.
const MP4_FIXTURE = '/fixtures/mp4/sample.mp4';

const REAL_EVENTS = [
  'abort', 'canplay', 'canplaythrough', 'durationchange', 'emptied', 'encrypted',
  'ended', 'loadeddata', 'loadedmetadata', 'loadstart', 'pause', 'play', 'playing',
  'progress', 'ratechange', 'seeked', 'seeking', 'stalled', 'suspend', 'timeupdate',
  'volumechange', 'waiting', 'waitingforkey', 'resize', 'enterpictureinpicture',
  'leavepictureinpicture', 'webkitbeginfullscreen', 'webkitendfullscreen',
  'webkitpresentationmodechanged',
];

const REAL_OBSERVED_ATTRIBUTES = [
  'autopictureinpicture', 'disablepictureinpicture', 'disableremoteplayback',
  'autoplay', 'controls', 'controlslist', 'crossorigin', 'loop', 'muted',
  'playsinline', 'poster', 'preload', 'src', 'live',
];

// The 65 HTMLVideoElement/HTMLMediaElement members super-media-element's
// nativeElProps loop installs, beyond the 6 it defines itself
// (nativeEl/src/preload/defaultMuted/loadComplete/isLoaded) and the 8 from
// media-tracks - see docs/public-api.md for the full breakdown.
const NATIVE_PASSTHROUGH_MEMBERS = [
  'width', 'height', 'videoWidth', 'videoHeight', 'poster', 'webkitDecodedFrameCount',
  'webkitDroppedFrameCount', 'playsInline', 'onenterpictureinpicture', 'onleavepictureinpicture',
  'disablePictureInPicture', 'cancelVideoFrameCallback', 'getVideoPlaybackQuality',
  'requestPictureInPicture', 'requestVideoFrameCallback', 'error', 'currentSrc', 'crossOrigin',
  'networkState', 'buffered', 'readyState', 'seeking', 'currentTime', 'duration', 'paused',
  'defaultPlaybackRate', 'playbackRate', 'played', 'seekable', 'ended', 'autoplay', 'loop',
  'preservesPitch', 'controls', 'controlsList', 'volume', 'muted', 'textTracks',
  'webkitAudioDecodedByteCount', 'webkitVideoDecodedByteCount', 'onencrypted', 'onwaitingforkey',
  'srcObject', 'NETWORK_EMPTY', 'NETWORK_IDLE', 'NETWORK_LOADING', 'NETWORK_NO_SOURCE',
  'HAVE_NOTHING', 'HAVE_METADATA', 'HAVE_CURRENT_DATA', 'HAVE_FUTURE_DATA', 'HAVE_ENOUGH_DATA',
  'addTextTrack', 'canPlayType', 'captureStream', 'load', 'pause', 'play', 'loading', 'sinkId',
  'remote', 'disableRemotePlayback', 'setSinkId', 'mediaKeys', 'setMediaKeys',
];

test.describe('public contract: statics', () => {
  test('Events is the real 28-entry list, "error" excluded', async ({ page }) => {
    await gotoPlayer(page);
    const events = await page.evaluate(() => (customElements.get('ultra-media') as any).Events);
    expect(events).toEqual(REAL_EVENTS);
    expect(events).not.toContain('error');
  });

  test('observedAttributes is the real 14-entry list ("live" appended)', async ({ page }) => {
    await gotoPlayer(page);
    const attrs = await page.evaluate(() => (customElements.get('ultra-media') as any).observedAttributes);
    expect(attrs).toEqual(REAL_OBSERVED_ATTRIBUTES);
  });

  test('skipAttributes is exactly ["src"]', async ({ page }) => {
    await gotoPlayer(page);
    const skip = await page.evaluate(() => (customElements.get('ultra-media') as any).skipAttributes);
    expect(skip).toEqual(['src']);
  });
});

test.describe('public contract: full prototype member inventory', () => {
  // ADR-0001 Fase 2: `initializePlayer` moved into UltraMediaCore's
  // load()/wireUp() (no longer a method on the element at all); the element
  // gained `createCore`/`forwardCoreEvent`/`syncMediaTracks` in its place -
  // internal detail, not public contract (docs/public-api.md never promised
  // specific private method names), so this list is updated accordingly -
  // everything else (own public surface + all 79 inherited members) is
  // unchanged, which is exactly what the rest of this file's tests confirm.
  test('exactly the 95 documented members exist (16 own + 79 inherited)', async ({ page }) => {
    await gotoPlayer(page);
    const names = await page.evaluate(() => {
      const Ctor = customElements.get('ultra-media') as any;
      const seen = new Set<string>();
      let proto = Ctor.prototype;
      while (proto && proto !== HTMLElement.prototype && proto !== Object.prototype) {
        for (const name of Object.getOwnPropertyNames(proto)) {
          if (name !== 'constructor') seen.add(name);
        }
        proto = Object.getPrototypeOf(proto);
      }
      return [...seen].sort();
    });

    const OWN = [
      'setupTrackListeners', 'connectedCallback', 'disconnectedCallback', 'destroy',
      'attributeChangedCallback', 'applySrcChange', 'createCore', 'forwardCoreEvent',
      'syncMediaTracks', 'removeAllMediaTracks', 'changeSource', 'getCurrentFormat',
    ];
    const SUPER_MEDIA_OWN = ['loadComplete', 'isLoaded', 'nativeEl', 'defaultMuted', 'src', 'preload'];
    const MEDIA_TRACKS = [
      'videoTracks', 'audioTracks', 'addVideoTrack', 'removeVideoTrack',
      'addAudioTrack', 'removeAudioTrack', 'videoRenditions', 'audioRenditions',
    ];

    const expected = [...OWN, ...SUPER_MEDIA_OWN, ...MEDIA_TRACKS, ...NATIVE_PASSTHROUGH_MEMBERS].sort();
    expect(names).toEqual(expected);
  });
});

test.describe('public contract: nativeEl', () => {
  test('nativeEl is a real <video> inside the shadow root (ultra-media-ad contract)', async ({ page }) => {
    await gotoPlayer(page);
    const info = await page.evaluate(() => {
      const el = document.querySelector('#player') as any;
      return {
        isVideoElement: el.nativeEl instanceof HTMLVideoElement,
        tagName: el.nativeEl.tagName,
        inShadowRoot: el.shadowRoot?.contains(el.nativeEl) ?? false,
      };
    });
    expect(info).toEqual({ isVideoElement: true, tagName: 'VIDEO', inShadowRoot: true });
  });
});

test.describe('public contract: attribute <-> property reflection', () => {
  // A fresh, attribute-less element - #player in player.html is preset with
  // `muted playsinline` (see e2e/pages/player.html), which would pollute the
  // "before" baseline here. Property names are the real camelCase
  // HTMLVideoElement ones (that's what super-media-element's nativeElProps
  // loop actually keys off - not a lowercased attribute name).
  test('boolean attributes reflect through the generic getter/setter', async ({ page }) => {
    await gotoPlayer(page);
    const result = await page.evaluate(() => {
      const el = document.createElement('ultra-media') as any;
      document.body.appendChild(el);
      const attrToProp: Record<string, string> = {
        autoplay: 'autoplay',
        controls: 'controls',
        loop: 'loop',
        playsinline: 'playsInline',
        disablepictureinpicture: 'disablePictureInPicture',
        disableremoteplayback: 'disableRemotePlayback',
      };
      const before: Record<string, unknown> = {};
      const after: Record<string, unknown> = {};
      for (const [attr, prop] of Object.entries(attrToProp)) before[attr] = el[prop];
      for (const attr of Object.keys(attrToProp)) el.setAttribute(attr, '');
      for (const [attr, prop] of Object.entries(attrToProp)) after[attr] = el[prop];
      el.remove();
      return { before, after };
    });
    for (const value of Object.values(result.before)) expect(value).toBe(false);
    for (const value of Object.values(result.after)) expect(value).toBe(true);
  });

  // Descoberta: `autopictureinpicture` is in `observedAttributes` (it comes
  // straight from super-media-element's static list) but this Chromium's
  // <video> has no `autoPictureInPicture` property at all - super-media-
  // element's nativeElProps loop only installs a getter/setter for
  // properties that actually exist on a real <video>, so this attribute
  // reflects into nothing today. Not a bug to fix here (see AGENTS.md golden
  // rule 4) - just something Fase 2 must not "helpfully" wire up.
  test('autopictureinpicture: observed, but there is no property to reflect into', async ({ page }) => {
    await gotoPlayer(page);
    const result = await page.evaluate(() => {
      const v = document.createElement('video');
      const el = document.createElement('ultra-media') as any;
      document.body.appendChild(el);
      const propExistsOnNativeVideo = 'autoPictureInPicture' in v;
      const before = el.autoPictureInPicture;
      el.setAttribute('autopictureinpicture', '');
      const after = el.autoPictureInPicture;
      el.remove();
      return { propExistsOnNativeVideo, before, after };
    });
    expect(result).toEqual({ propExistsOnNativeVideo: false, before: undefined, after: undefined });
  });

  test('string attributes reflect through the generic getter/setter', async ({ page }) => {
    await gotoPlayer(page);
    const result = await page.evaluate(() => {
      const el = document.createElement('ultra-media') as any;
      document.body.appendChild(el);
      el.setAttribute('crossorigin', 'anonymous');
      el.setAttribute('preload', 'metadata');
      el.setAttribute('poster', '/fixtures/mp4/sample.mp4');
      el.setAttribute('controlslist', 'nodownload');
      const result = {
        crossOrigin: el.crossOrigin,
        preload: el.preload,
        poster: el.poster,
        controlsList: el.controlsList?.value ?? String(el.controlsList),
      };
      el.remove();
      return result;
    });
    expect(result.crossOrigin).toBe('anonymous');
    expect(result.preload).toBe('metadata');
    expect(result.poster).toContain('/fixtures/mp4/sample.mp4');
    expect(result.controlsList).toContain('nodownload');
  });

  // Descoberta (docs/public-api.md): unlike the other booleans above, `muted`
  // is deliberately excluded from super-media-element's generic attr<->prop
  // set. The property always proxies straight to nativeEl.muted; the
  // attribute only seeds nativeEl's *initial* muted state at connect time
  // (same as native <video muted>), so setting it afterwards is a no-op on
  // the live property.
  test('muted: attribute only seeds the initial nativeEl state, property proxies live', async ({ page }) => {
    await gotoPlayer(page);
    const result = await page.evaluate(() => {
      const el = document.createElement('ultra-media') as any;
      document.body.appendChild(el);
      const initial = el.muted;
      el.setAttribute('muted', '');
      const afterAttr = el.muted;
      el.muted = true;
      const afterProp = el.muted;
      el.remove();
      return { initial, afterAttr, afterProp };
    });
    expect(result.initial).toBe(false);
    expect(result.afterAttr).toBe(false);
    expect(result.afterProp).toBe(true);
  });
});

test.describe('public contract: "live" attribute is observed but inert (Descoberta)', () => {
  test('isLive stays false regardless of the "live" attribute', async ({ page }) => {
    await gotoPlayer(page);
    const result = await page.evaluate(() => {
      const el = document.querySelector('#player') as any;
      const before = el.isLive;
      el.setAttribute('live', '');
      const after = el.isLive;
      el.removeAttribute('live');
      return { before, after };
    });
    expect(result).toEqual({ before: false, after: false });
  });
});

test.describe('public contract: media-tracks lists', () => {
  test('videoTracks/audioTracks/videoRenditions/audioRenditions exist and are iterable and empty before any load', async ({ page }) => {
    await gotoPlayer(page);
    const result = await page.evaluate(() => {
      const el = document.querySelector('#player') as any;
      return {
        videoTracks: [...el.videoTracks].length,
        audioTracks: [...el.audioTracks].length,
        videoRenditions: [...el.videoRenditions].length,
        audioRenditions: [...el.audioRenditions].length,
      };
    });
    expect(result).toEqual({ videoTracks: 0, audioTracks: 0, videoRenditions: 0, audioRenditions: 0 });
  });
});

test.describe('public contract: native passthrough proxies to nativeEl (mp4, no SDK involved)', () => {
  test('currentTime/volume/muted/paused/duration/play()/pause()/load() all proxy through', async ({ page }) => {
    await gotoPlayer(page);
    await instrument(page);
    await setSrc(page, MP4_FIXTURE);

    await expect.poll(async () => (await getLog(page)).some((e) => e.name === 'loadedmetadata')).toBe(true);

    const duration = await getProp(page, 'duration');
    expect(duration).toBeGreaterThan(0);

    await callMethod(page, 'play');
    await expect.poll(async () => (await getProp(page, 'currentTime')) as number, { timeout: 10_000 }).toBeGreaterThan(0.2);
    expect(await getProp(page, 'paused')).toBe(false);

    await callMethod(page, 'pause');
    await expect.poll(async () => getProp(page, 'paused')).toBe(true);

    const volumeResult = await page.evaluate(() => {
      const el = document.querySelector('#player') as HTMLVideoElement;
      el.volume = 0.3;
      el.muted = true;
      return { volume: el.volume, muted: el.muted, nativeVolume: (el as any).nativeEl.volume, nativeMuted: (el as any).nativeEl.muted };
    });
    expect(volumeResult).toEqual({ volume: 0.3, muted: true, nativeVolume: 0.3, nativeMuted: true });

    // load() is the native HTMLVideoElement passthrough (not our own
    // load()) - proxies straight to nativeEl.load(), which resets playback.
    await callMethod(page, 'load');
    await expect.poll(async () => getProp(page, 'currentTime')).toBe(0);
  });
});

// This entry never registers <ultra-media-ad> - see entrypoints.spec.ts for
// the dedicated isolation gate; this just cross-checks the same fact from
// the contract's point of view (nothing here should ever depend on ads).
test.describe('public contract: entry isolation cross-check', () => {
  test('the core entry never registers <ultra-media-ad>', async ({ page }) => {
    await gotoPlayer(page);
    const adDefined = await page.evaluate(() => customElements.get('ultra-media-ad') !== undefined);
    expect(adDefined).toBe(false);
  });
});
