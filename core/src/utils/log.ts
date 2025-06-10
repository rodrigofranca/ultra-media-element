import qs from "./qs";

const colors = {
  LOG: '#353535',
  DFP: '#2A852B',
  METRICS: '#E67C17',
  ERROR: '#850000',
  TIME: '#356AFF',
  TIMEOUT: '#7f2fd8',
  HLS: '#a4c0Ff',
  DASH: '#4286f4',
  TEST: '#e100ff',
  WARNING: '#ff8c00'
};

const tag = '[Ultra Media Element]';

export const log = (message: string, type: keyof typeof colors = 'LOG') => {
  console.log(
    `%c${tag}${type !== 'LOG' ? `[${type}]` : ''} ${message}`,
    `background: ${colors[type]}; color: #fff; font-size: 12px`
  );
};
export const debug = (message: string, type: keyof typeof colors = 'LOG') => {
  if (!qs.get('debug')) return;
  log(message, type);
};

export const showAppInfo = () => {
  const __APP_NAME__ = null;
  const __APP_VERSION__ = null;
  if (!__APP_NAME__) return;
  log(`${__APP_NAME__} ${__APP_VERSION__}`);
};
