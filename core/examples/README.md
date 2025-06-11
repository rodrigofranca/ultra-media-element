# Ultra Media Element Examples

This directory contains various examples demonstrating the usage of the Ultra Media Element web component.

## Examples

1. **Basic Player** (`basic-player.html`)
   - Simple video playback
   - Basic controls
   - Minimal setup

2. **Ad Player** (`ad-player.html`)
   - Integration with Google IMA ads
   - Side-by-side video and ad display
   - Ad event handling

3. **HLS Player** (`hls-player.html`)
   - HLS stream playback
   - Multiple stream examples
   - Stream switching

4. **DASH Player** (`dash-player.html`)
   - DASH stream playback
   - Live and VOD examples
   - Stream quality selection

5. **Audio Player** (`audio-player.html`)
   - Audio file playback
   - Compact audio player UI
   - Multiple track selection

6. **Media Chrome Player** (`media-chrome-player.html`)
   - Custom media-chrome controls
   - Advanced UI components
   - Styled control bars
   - Custom control layout
   - Interactive hover effects

## Local Development

### Prerequisites

- Node.js (v16 or higher)
- npm (v7 or higher)

### Setup

1. Clone the repository:
   ```bash
   git clone https://github.com/your-username/ultra-media-element.git
   cd ultra-media-element/core
   ```

2. Install dependencies and build the library:
   ```bash
   npm install
   npm run build
   ```

### Running Examples

You have two options to run the examples:

#### Option 1: Using Vite Dev Server (Recommended)

1. Start the examples server:
   ```bash
   npm run serve:examples
   ```

This will:
- Start a dev server on port 3000
- Enable CORS for external resources
- Open your default browser automatically
- Provide live reload for development

The examples will be available at http://localhost:3000/

#### Option 2: Using npm run dev

1. Start the development server:
   ```bash
   npm run dev
   ```

2. Open http://localhost:5173/examples/ in your browser
   - The index page will show all available examples
   - Hot reload is enabled for development

### Development Tips

- The examples use CDN links for dependencies to make them self-contained
- Each example can be run independently by opening its HTML file directly
- Check the browser console for any potential errors or warnings
- The examples use different video sources to demonstrate various formats:
  - MP4: Basic video files
  - HLS: Streaming with adaptive bitrate
  - DASH: Advanced streaming features
  - Audio: MP3 files

## Notes

- All examples use the latest version of media-chrome for UI controls
- HLS examples require the hls-video-element package
- Ad examples require the Google IMA SDK
- Make sure you have a stable internet connection as examples use remote media streams

## Troubleshooting

### Common Issues

1. **Core library not found**
   - Make sure you've built the core library (`npm run build`)
   - Check if the path to dist/index.js is correct

2. **CORS Issues**
   - Some media sources might be blocked by CORS
   - Use the development server instead of opening files directly

3. **Playback Issues**
   - Check if your browser supports the media format
   - Verify your internet connection for streaming examples
   - Look for console errors related to media loading

### Getting Help

If you encounter any issues:
1. Check the browser console for errors
2. Verify all prerequisites are installed
3. Make sure all dependencies are properly loaded
4. Try using a different browser to isolate the issue 