# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Structure

This is a Web Components library called Ultra Media Element that provides multi-format media playback (HLS, DASH, MP4, MP3, YouTube) with automatic format detection. The main development happens in the `core/` directory.

### Key Architecture Components

- **UltraMediaElement**: Main custom element (`<ultra-media>`) extending SuperVideoElement with MediaTracksMixin
- **PlayerFactory**: Creates appropriate player instances based on detected format using a plugin architecture
- **Format Detection**: Automatic format detection from URLs using file extensions and domain patterns
- **IMediaPlayer Interface**: Common interface for all player implementations (HLS, DASH, Video, Audio, YouTube)
- **Media Tracks Integration**: Full audio tracks, video renditions, and subtitles support via media-tracks library

### Player Architecture

Each media format has its own player class implementing `IMediaPlayer`:
- `HlsPlayer` - Uses hls.js for .m3u8 streams
- `DashPlayer` - Uses dash.js for .mpd streams  
- `VideoPlayer` - Native HTML5 video for .mp4/.webm/.ogg
- `AudioPlayer` - Native HTML5 audio for .mp3/.wav/.ogg
- `YouTubePlayer` - YouTube IFrame API for youtube.com URLs

Players are registered in `PlayerFactory` and selected automatically based on source URL format detection.

## Development Commands

**Working Directory**: All commands should be run from `core/` directory

```bash
cd core
```

### Essential Commands
- `pnpm dev` - Start development server with HTTPS and HMR
- `pnpm build` - Build library (ESM + UMD bundles to dist/)
- `pnpm watch` - Build in watch mode
- `pnpm test` - Run Jest tests
- `pnpm preview` - Preview built library

### Testing
- Tests are in `tests/` directory using Jest with jsdom environment
- Test files follow pattern: `*.test.ts`
- Run single test: `pnpm test -- format-detector.test.ts`

## Important Files and Locations

- Main entry: `src/index.ts` - Registers custom elements
- Core element: `src/ultra-media-element.ts` - Main UltraMediaElement class
- Player factory: `src/core/player-factory.ts` - Player creation and format mapping
- Format detection: `src/core/format-detector.ts` - URL format detection logic
- Players: `src/players/` - Individual player implementations
- Types: `src/core/media-player.ts` - Core interfaces and types
- Build config: `vite.config.ts` - Library build configuration
- Tests: `tests/` - Jest test files

## Build Configuration

- Uses Vite for building with library mode
- Generates both ESM and UMD bundles
- TypeScript declarations generated to `dist/`
- Custom Elements Manifest generated for IDE support
- VSCode HTML custom data support via `vscode.html-custom-data.json`

## Key Dependencies

- `super-media-element` - Base class for custom media elements
- `media-tracks` - Audio tracks, video renditions, and subtitles support
- `hls.js` and `dash.js` - Streaming media support (loaded dynamically)
- `ima-ad-player` - Google IMA ads integration

## Project Documentation

The `/docs` folder contains comprehensive project analysis and implementation plans:

- **`/docs/evaluation/`** - Detailed 6-part project analysis covering purpose, architecture, code quality, community potential, and evolution roadmap
- **`/docs/implementation/`** - Technical implementation plans for features like YouTube embed support and iframe/events refactoring
- **`/docs/tasks.md`** - Feature roadmap with implementation status

## Development Notes

- The project uses pnpm as package manager (pnpm-lock.yaml present)
- All players implement the `IMediaPlayer` interface for consistency
- Format detection happens automatically on src attribute changes
- YouTube player creates iframe as sibling to video element, not replacing it
- Media tracks are automatically synchronized between players and the element's track lists
- Event simulation for YouTube player translates YouTube API events to standard HTMLMediaElement events

## Current Feature Status

**Completed Features:**
- ✅ Multi audio track support
- ✅ Video quality/renditions support  
- ✅ Subtitles support via `<track>` elements
- ✅ Advertisement component (ultra-media-ad)
- ✅ YouTube embed support

**Planned Features:**
- ⏳ Library extension capabilities (Dash.js, HLS.js customization)
- ⏳ Custom URL support for self-hosted libraries
- ⏳ DRM support for protected content
- ⏳ URL signature support
- ⏳ Video sequence/playlist support
- ⏳ Preload optimization using web workers
- ⏳ XHR request override capabilities

## Known Architecture Considerations

- YouTube iframe positioning: Creates iframe as sibling to video element within UltraMediaElement container
- Event mapping: YouTube API events are translated to standard media events (play, pause, timeupdate, ended)
- Player factory uses format detection to automatically select appropriate player implementation
- Media tracks integration provides standardized audio/video track switching across all player types