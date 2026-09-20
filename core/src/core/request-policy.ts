/**
 * ADR-0001 D4 - host authentication/signed-URL policy applied to every
 * engine's requests where technically possible. `engine` is not in the
 * ADR's original sketch - added here so a `headers` function can tell which
 * engine issued the request without re-deriving it from `type`/`url` (see
 * docs/adr/0001-headless-core-and-element-shell.md, "Status da etapa 4").
 */
export interface RequestContext {
  url: string;
  type: 'manifest' | 'segment' | 'key' | 'license' | 'other';
  engine: string;
}

export interface RequestPolicy {
  headers?: Record<string, string> | ((ctx: RequestContext) => Record<string, string> | void);
  credentials?: 'omit' | 'same-origin' | 'include';
  transformUrl?: (ctx: RequestContext) => string | void;
}
