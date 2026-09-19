// `@rodrigofranca/ultra-media/core` - the headless engine, no Custom
// Elements, no Shadow DOM, no Mux dependencies (ADR-0001). Consumers own
// their <video>/<audio> element and hand it to `UltraMediaCore` directly:
//
//   import { UltraMediaCore } from '@rodrigofranca/ultra-media/core';
//   const core = new UltraMediaCore(document.querySelector('video'));
//   core.load('https://example.com/master.m3u8');
export { UltraMediaCore } from './core/ultra-media-core';
export type {
  UltraMediaCoreOptions,
  UltraMediaSource,
  UltraMediaCoreEvent,
  UltraMediaCoreEventType,
} from './core/ultra-media-core';
// A real (value) export, not `export type` - Format is a runtime enum;
// consumers pass `{ src, type: Format.HLS }` to `UltraMediaCore.load()`.
export { Format } from './core/format';
export type { MediaPlayerError, MediaErrorCategory, VideoRendition, MediaTrack } from './core/media-player';
