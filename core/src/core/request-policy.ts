/**
 * ADR-0001 D4 - host authentication/signed-URL policy applied to every
 * engine's requests where technically possible. `engine` is not in the
 * ADR's original sketch - added here so a `headers` function can tell which
 * engine issued the request without re-deriving it from `type`/`url` (see
 * docs/adr/0001-headless-core-and-element-shell.md, "Status da etapa 4").
 */
export interface RequestContext {
  url: string;
  /**
   * `'license'` is reserved for DRM (P2, not implemented - ADR-0001 D7).
   * hls.js/dash.js both issue license requests through a hook this package
   * doesn't wire up yet (`config.licenseXhrSetup` /
   * `registerLicenseRequestFilter`), never through the hooks `RequestPolicy`
   * applies through today - so no request ever actually carries this type
   * yet, even though dash.js's own type strings already distinguish it.
   */
  type: 'manifest' | 'segment' | 'key' | 'license' | 'other';
  engine: string;
}

export interface RequestPolicy {
  headers?: Record<string, string> | ((ctx: RequestContext) => Record<string, string> | void);
  /**
   * Real per-value behavior depends on which Web Platform API the active
   * engine/loader actually issues the request through (README.md's
   * "Semântica exata de credentials" has the full matrix):
   * - Fetch (`hls.js`'s `fetchSetup`, only reached if a host swaps in its
   *   `FetchLoader`): all three values are distinct, exactly as named.
   * - XHR (`hls.js`'s default `xhrSetup`, `dash.js`'s default loader) and
   *   `<video>`/`<audio>`'s `crossOrigin` (native/HLS-without-MSE): neither
   *   API has an "omit credentials even same-origin" mode, so `'omit'` and
   *   `'same-origin'` are indistinguishable there - only `'include'`
   *   changes observable behavior.
   */
  credentials?: 'omit' | 'same-origin' | 'include';
  transformUrl?: (ctx: RequestContext) => string | void;
}
