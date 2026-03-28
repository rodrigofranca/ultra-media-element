Build an interactive showroom landing page for "Ultra Media Element" - an enterprise video player library.

  DESIGN: Dark theme (#0A1F44 to #0F0F0F gradient), neon purple accents (#A855F7), cyan highlights (#00D9FF). Typography: Inter Bold for headings,
  JetBrains Mono for code. Glassmorphism effects with blur(20px).

  HERO SECTION (100vh):
  - 3D skewed video player (rotateY: 8deg) centered with floating animation
  - Headline: "One Player. Every Format. Zero Complexity."
  - Glassmorphism container around player with glow effect
  - Animated particles background
  - Player normalizes (skew→0deg) on scroll

  SECTION 2 - Multi-Format (80vh):
  - Player becomes STICKY (left 60%)
  - Content right 40%: format badges (HLS, DASH, MP4, YouTube)
  - Player thumbnail changes as user scrolls through formats
  - Code snippet with typing animation: `<ultra-media src="video.m3u8" />`

  SECTION 3 - Media Tracks (80vh):
  - Player still sticky
  - UI overlays appear: audio tracks, quality selector (720p/1080p/4K), subtitles
  - Ripple effects on player when changing tracks
  - Feature cards with icons

  SECTION 4 - Enterprise (100vh):
  - Player transforms into 2x2 grid of mini players
  - Dashboard metrics: "100K+ Users", "Multi-CDN", animated counters
  - World map with pulse indicators

  SECTION 5 - Monetization (70vh):
  - Single player with simulated ad overlay
  - Ad countdown timer, skip button
  - Revenue metrics sidebar
  - Code: `<ultra-media-ad ad-tag-url="..." />`

  SECTION 6 - Developer Experience (90vh):
  - Split: VSCode-style code editor (left) | live player preview (right)
  - Code types in with syntax highlighting
  - Interactive tabs: basic.html, advanced.html

  SECTION 7 - Roadmap (70vh):
  - Cinematic widescreen player
  - "Coming Soon" feature cards floating: DRM, Analytics, Playlists
  - Holographic glow effects
  - Timeline visualization

  FINAL CTA (60vh):
  - Player "lands" with bounce animation
  - 3 buttons: "View Docs", "Try Demo", "GitHub"
  - NPM install command with copy button
  - Stats: 50K+ downloads, 5K+ stars

  INTERACTIONS:
  - Smooth scroll-triggered animations (Framer Motion or GSAP)
  - Player sticky positioning in sections 2-5
  - Intersection Observer for section triggers
  - Hover effects: scale + glow on buttons
  - Auto-play players when visible

  TECH STACK: React + Tailwind CSS + Framer Motion. Responsive (mobile: stack vertically, no 3D effects; desktop: full experience). Use placeholder
  videos (colored gradients) and Lucide icons.

  PERFORMANCE: GPU-accelerated animations (CSS transforms), lazy load images, <2.5s LCP, smooth 60fps scrolling.

  Make it feel premium, innovative, enterprise-grade with smooth transitions and glassmorphism depth effects throughout