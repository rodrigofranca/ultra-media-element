const EMBED_BASE = 'https://www.youtube.com/embed';
// const API_URL = 'https://www.youtube.com/iframe_api';
// const API_GLOBAL = 'YT';
// const API_GLOBAL_READY = 'onYouTubeIframeAPIReady';
const MATCH_SRC =
  /(?:youtu\.be\/|youtube\.com\/(?:shorts\/|embed\/|v\/|watch\?v=|watch\?.+&v=))((\w|-){11})/;


export const delay = (time: number) => {
  return new Promise((res) => {
    setTimeout(res, time);
  });
};
export function serialize(props) {
  return String(new URLSearchParams(boolToBinary(props)));
}

function boolToBinary(props) {
  let p = {};
  for (let key in props) {
    let val = props[key];
    if (val === true || val === '') p[key] = 1;
    else if (val === false) p[key] = 0;
    else if (val != null) p[key] = val;
  }
  return p;
}

export function serializeIframeUrl(attrs) {
  if (!attrs.src) return;

  const matches = attrs.src.match(MATCH_SRC);
  const srcId = matches && matches[1];

  const params = {
    // ?controls=true is enabled by default in the iframe
    controls: attrs.controls === '' ? null : 0,
    autoplay: attrs.autoplay,
    loop: attrs.loop,
    mute: attrs.muted,
    playsinline: attrs.playsinline,
    preload: attrs.preload ?? 'metadata',
    // origin: globalThis.location?.origin,
    enablejsapi: 1,
    showinfo: 0,
    rel: 0,
    iv_load_policy: 3,
    modestbranding: 1,
  };

  return `${EMBED_BASE}/${srcId}?${serialize(params)}`;
}