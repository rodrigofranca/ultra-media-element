const L = [
  "abort",
  "canplay",
  "canplaythrough",
  "durationchange",
  "emptied",
  "encrypted",
  "ended",
  "error",
  "loadeddata",
  "loadedmetadata",
  "loadstart",
  "pause",
  "play",
  "playing",
  "progress",
  "ratechange",
  "seeked",
  "seeking",
  "stalled",
  "suspend",
  "timeupdate",
  "volumechange",
  "waiting",
  "waitingforkey",
  "resize",
  "enterpictureinpicture",
  "leavepictureinpicture",
  "webkitbeginfullscreen",
  "webkitendfullscreen",
  "webkitpresentationmodechanged"
], w = globalThis.document?.createElement("template");
w && (w.innerHTML = /*html*/
`
    <style>
      :host {
        display: inline-block;
        line-height: 0;
      }

      video,
      audio {
        max-width: 100%;
        max-height: 100%;
        min-width: 100%;
        min-height: 100%;
      }
    </style>
    <slot></slot>
  `);
const A = (s, { tag: t, is: o }) => {
  const n = globalThis.document?.createElement(t, { is: o }), l = n ? E(n) : [];
  return class y extends s {
    static Events = L;
    static template = w;
    static skipAttributes = [];
    static #i;
    static get observedAttributes() {
      return y.#l(), [
        ...n?.constructor?.observedAttributes ?? [],
        "autopictureinpicture",
        "disablepictureinpicture",
        "disableremoteplayback",
        "autoplay",
        "controls",
        "controlslist",
        "crossorigin",
        "loop",
        "muted",
        "playsinline",
        "poster",
        "preload",
        "src"
      ];
    }
    static #l() {
      if (this.#i) return;
      this.#i = !0;
      const e = new Set(this.observedAttributes);
      e.delete("muted");
      for (let i of l) {
        if (i in this.prototype) continue;
        if (typeof n[i] == "function")
          this.prototype[i] = function(...r) {
            this.#t();
            const a = () => this.call ? this.call(i, ...r) : this.nativeEl[i].apply(this.nativeEl, r);
            return this.loadComplete && !this.isLoaded ? this.loadComplete.then(a) : a();
          };
        else {
          let r = {
            get() {
              this.#t();
              let a = i.toLowerCase();
              if (e.has(a)) {
                const u = this.getAttribute(a);
                return u === null ? !1 : u === "" ? !0 : u;
              }
              return this.get?.(i) ?? this.nativeEl?.[i] ?? this.#s[i];
            }
          };
          i !== i.toUpperCase() && (r.set = async function(a) {
            this.#t();
            let u = i.toLowerCase();
            if (e.has(u)) {
              a === !0 || a === !1 || a == null ? this.toggleAttribute(u, !!a) : this.setAttribute(u, a);
              return;
            }
            if (this.loadComplete && !this.isLoaded && await this.loadComplete, this.set) {
              this.set(i, a);
              return;
            }
            this.nativeEl[i] = a;
          }), Object.defineProperty(this.prototype, i, r);
        }
      }
    }
    #o;
    #n;
    #r = !1;
    #e = !1;
    #a;
    #s;
    constructor() {
      super(), this.shadowRoot || (this.attachShadow({ mode: "open" }), this.shadowRoot.append(this.constructor.template.content.cloneNode(!0))), this.load !== y.prototype.load && (this.loadComplete = new v());
    }
    get loadComplete() {
      return this.#n;
    }
    set loadComplete(e) {
      this.#e = !1, this.#n = e, e?.then(() => {
        this.#e = !0;
      });
    }
    get isLoaded() {
      return this.#e;
    }
    get nativeEl() {
      return this.#a ?? this.shadowRoot.querySelector(t) ?? this.querySelector(t);
    }
    set nativeEl(e) {
      this.#a = e;
    }
    get defaultMuted() {
      return this.hasAttribute("muted");
    }
    set defaultMuted(e) {
      this.toggleAttribute("muted", !!e);
    }
    get src() {
      return this.getAttribute("src");
    }
    set src(e) {
      this.setAttribute("src", `${e}`);
    }
    get preload() {
      return this.getAttribute("preload") ?? this.nativeEl?.preload;
    }
    set preload(e) {
      this.setAttribute("preload", `${e}`);
    }
    async #t() {
      if (this.#o) return;
      this.#o = !0, this.#h(), this.#c();
      for (let d of l)
        this.#d(d);
      const e = /* @__PURE__ */ new Map(), i = this.shadowRoot.querySelector("slot:not([name])");
      i?.addEventListener("slotchange", () => {
        const d = new Map(e);
        i.assignedElements().filter((r) => ["track", "source"].includes(r.localName)).forEach(async (r) => {
          d.delete(r);
          let a = e.get(r);
          a || (a = r.cloneNode(), e.set(r, a)), this.loadComplete && !this.isLoaded && await this.loadComplete, this.nativeEl.append?.(a);
        }), d.forEach((r) => r.remove());
      });
      for (let d of this.constructor.Events)
        this.shadowRoot.addEventListener?.(d, (r) => {
          r.target === this.nativeEl && this.dispatchEvent(new CustomEvent(r.type, { detail: r.detail }));
        }, !0);
    }
    #d(e) {
      if (Object.prototype.hasOwnProperty.call(this, e)) {
        const i = this[e];
        delete this[e], this[e] = i;
      }
    }
    #h() {
      const e = document.createElement(t, { is: o });
      e.muted = this.hasAttribute("muted");
      for (let { name: i, value: d } of this.attributes)
        e.setAttribute(i, d);
      this.#s = {};
      for (let i of E(e))
        this.#s[i] = e[i];
      e.removeAttribute("src"), e.load();
    }
    async #c() {
      if (this.loadComplete && !this.isLoaded && await this.loadComplete, !this.nativeEl) {
        const e = document.createElement(t, { is: o });
        e.part = t, this.shadowRoot.append(e);
      }
      this.nativeEl.muted = this.hasAttribute("muted");
    }
    attributeChangedCallback(e, i, d) {
      this.#t(), e === "src" && this.load !== y.prototype.load && this.#u(), this.#p(e, i, d);
    }
    async #u() {
      this.#r && (this.loadComplete = new v()), this.#r = !0, await Promise.resolve(), await this.load(), this.loadComplete?.resolve(), await this.loadComplete;
    }
    async #p(e, i, d) {
      this.loadComplete && !this.isLoaded && await this.loadComplete, !["id", "class", ...this.constructor.skipAttributes].includes(e) && (d === null ? this.nativeEl.removeAttribute?.(e) : this.nativeEl.setAttribute?.(e, d));
    }
    connectedCallback() {
      this.#t();
    }
  };
};
function E(s) {
  let t = [];
  for (let o = Object.getPrototypeOf(s); o && o !== HTMLElement.prototype; o = Object.getPrototypeOf(o))
    t.push(...Object.getOwnPropertyNames(o));
  return t;
}
class v extends Promise {
  constructor(t = () => {
  }) {
    let o, n;
    super((l, c) => {
      t(l, c), o = l, n = c;
    }), this.resolve = o, this.reject = n;
  }
}
const M = globalThis.document ? A(HTMLElement, { tag: "video" }) : class {
};
globalThis.document && A(HTMLElement, { tag: "audio" });
var h = /* @__PURE__ */ ((s) => (s.HLS = "hls", s.MP4 = "mp4", s.DASH = "dash", s.AUDIO = "audio", s))(h || {});
function C(s) {
  const t = s.toLowerCase();
  if (t.includes(".m3u8")) return h.HLS;
  if (t.includes(".mpd")) return h.DASH;
  if (/\.(mp4|webm|ogg)/.test(t)) return h.MP4;
  if (/\.(mp3|wav|ogg)/.test(t)) return h.AUDIO;
}
const j = {
  LOG: "#353535",
  DFP: "#2A852B",
  METRICS: "#E67C17",
  ERROR: "#850000",
  TIME: "#356AFF",
  TIMEOUT: "#7f2fd8",
  HLS: "#a4c0Ff",
  DASH: "#4286f4",
  TEST: "#e100ff",
  WARNING: "#ff8c00"
}, T = "[Ultra Media Element]", P = (s, t = "LOG") => {
  console.log(
    `%c${T}${t !== "LOG" ? `[${t}]` : ""} ${s}`,
    `background: ${j[t]}; color: #fff; font-size: 12px`
  );
}, H = (...s) => {
}, m = (s) => typeof s > "u", S = (s, t, o, n = () => !0, l = O) => {
  const c = (i) => {
    if (!m(window[i])) return window[i];
    if (window.exports && window.exports[i]) return window.exports[i];
    if (window.module && window.module.exports && window.module.exports[i])
      return window.module.exports[i];
  }, e = c(t);
  return e && n(e) ? Promise.resolve(e) : new Promise((i, d) => {
    if (!m(f[s])) {
      f[s].push({ resolve: i, reject: d });
      return;
    }
    f[s] = [{ resolve: i, reject: d }];
    const r = (p) => {
      f[s].forEach((g) => g.resolve(p));
    }, a = (p) => {
      throw f[s].forEach((g) => {
        g.reject(p);
      }), delete f[s], p;
    };
    if (!m(o)) {
      const p = window[o];
      window[o] = function() {
        m(p) || p(), r(c(t));
      };
    }
    const u = window.System;
    u && u.hasOwnProperty("import") ? u.import(s).then((p) => r(p.default)).catch(a) : l(
      s,
      () => {
        m(o) && r(c(t));
      },
      a
    );
  });
}, O = (s, t, o = H) => {
  const n = document.createElement("script");
  n.src = s, n.onload = t, n.onerror = o;
  const l = document.getElementsByTagName("script")[0];
  l.parentNode?.insertBefore(n, l);
}, f = {};
class R {
  constructor(t) {
    this.element = t, P("Powered by Hls.js"), this.nativeEl = t, this.onReady = new Promise((o, n) => {
      this.setup().then(o).catch(n);
    });
  }
  nativeEl;
  onReady;
  Hls;
  hls;
  sdkSrc = "https://cdn.jsdelivr.net/npm/hls.js@latest/dist/hls.min.js";
  config = {};
  async setup() {
    m(this.Hls) && (this.Hls = await S(this.sdkSrc, "Hls")), this.hls = new this.Hls(this.config), this.hls.attachMedia(this.nativeEl);
  }
  destroy() {
    this.hls && (this.hls.destroy(), this.hls = null);
  }
  load(t) {
    this.Hls && (this.Hls?.isSupported() ? this.hls.loadSource(t) : this.nativeEl.canPlayType("application/vnd.apple.mpegurl") ? this.nativeEl.src = t : console.error("HLS não suportado no navegador."));
  }
}
class D {
  constructor(t) {
    this.element = t, this.onReady = Promise.resolve();
  }
  onReady;
  load(t) {
    this.element.src = t;
  }
  destroy() {
    this.element.src = "";
  }
}
class x {
  constructor(t) {
    this.element = t, P("Powered by dash.js"), this.nativeEl = t, this.onReady = new Promise((o, n) => {
      this.setup().then(o).catch(n);
    });
  }
  nativeEl;
  onReady;
  dashjs;
  player;
  sdkSrc = "https://cdn.jsdelivr.net/npm/dashjs@latest/dist/dash.all.min.js";
  config = {
    streaming: {
      abr: {
        autoSwitchBitrate: !0
      }
    }
  };
  async setup() {
    m(this.dashjs) && (this.dashjs = await S(this.sdkSrc, "dashjs")), this.player = this.dashjs.MediaPlayer().create(), this.player.initialize(this.nativeEl, null, !0), this.player.updateSettings(this.config);
  }
  load(t) {
    this.player && this.player.attachSource(t);
  }
  destroy() {
    this.player && (this.player.destroy(), this.player = null);
  }
}
class k {
  constructor(t) {
    this.element = t, this.onReady = Promise.resolve();
  }
  onReady;
  load(t) {
    this.element.src = t;
  }
  destroy() {
    this.element.src = "";
  }
}
const F = {
  [h.HLS]: "hls.js",
  [h.MP4]: "video/mp4",
  [h.DASH]: "dash.js",
  [h.AUDIO]: "audio/mp3"
}, U = /* @__PURE__ */ new Map([
  ["hls.js", (s) => new R(s)],
  ["video/mp4", (s) => new D(s)],
  ["dash.js", (s) => new x(s)],
  ["audio/mp3", (s) => new k(s)]
]);
function I(s) {
  const t = s.dataset?.type, o = {
    "hls.js": h.HLS,
    "dash.js": h.DASH,
    "video/mp4": h.MP4,
    "audio/mp3": h.AUDIO
  };
  return t ? o[t] : void 0;
}
class $ {
  static create({ src: t, element: o, formats: n }) {
    const l = this.resolveEngine(t, n ?? F), c = U.get(l);
    if (!c)
      throw new Error(`No engine registered for: ${l}`);
    o.dataset.type = l;
    const e = c(o);
    return e.onReady.then(() => e.load(t)), e;
  }
  static resolveEngine(t, o) {
    const n = C(t);
    if (!n)
      throw new Error(`Unsupported media source: ${t}`);
    const l = o[n];
    if (!l)
      throw new Error(`Format ${n} is not configured in formats`);
    return l;
  }
}
class N extends M {
  player = null;
  static skipAttributes = ["src"];
  test = "test";
  constructor() {
    super();
  }
  async connectedCallback() {
    super.connectedCallback?.(), this.loadComplete && !this.isLoaded && await this.loadComplete, this.initializePlayer();
  }
  async attributeChangedCallback(t, o, n) {
    if (super.attributeChangedCallback?.(t, o, n), t === "src" && o !== n) {
      this.loadComplete && !this.isLoaded && await this.loadComplete;
      const l = this.getCurrentFormat(), c = C(n ?? "");
      l !== c && this.destroyPlayer(), this.player && l === c ? this.player.load(n) : this.initializePlayer();
    }
  }
  initializePlayer() {
    if (!this.nativeEl || !this.src) {
      console.warn("[MyVideoElement] nativeEl or src not available yet");
      return;
    }
    this.player = $.create({
      src: this.src,
      element: this.nativeEl
    });
  }
  async changeSource(t) {
    if (!t) {
      console.warn("[MyVideoElement] Invalid source");
      return;
    }
    this.setAttribute("src", t);
  }
  getCurrentFormat() {
    return this.nativeEl ? I(this.nativeEl) : void 0;
  }
  destroyPlayer() {
    this.player?.destroy && this.player.destroy(), this.player = null;
  }
}
const b = "ultra-media";
globalThis.customElements && !globalThis.customElements.get(b) && globalThis.customElements.define(b, N);
//# sourceMappingURL=ultra-media-element.es.js.map
