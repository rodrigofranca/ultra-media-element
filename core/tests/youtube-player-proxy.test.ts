import { YouTubePlayer } from '../src/players/youtube-player';

// Mock YouTube API
const mockYouTubeAPI = {
  Player: jest.fn().mockImplementation(() => ({
    destroy: jest.fn(),
    playVideo: jest.fn(),
    pauseVideo: jest.fn(),
    getCurrentTime: jest.fn(() => 0),
    getDuration: jest.fn(() => 0),
    getVolume: jest.fn(() => 100),
    isMuted: jest.fn(() => false),
    getPlayerState: jest.fn(() => 1), // PLAYING
  })),
  PlayerState: {
    UNSTARTED: -1,
    ENDED: 0,
    PLAYING: 1,
    PAUSED: 2,
    BUFFERING: 3,
    CUED: 5
  }
};

// Mock global YouTube API
Object.defineProperty(window, 'YT', {
  value: mockYouTubeAPI,
  writable: true
});

describe('YouTubePlayer Proxy Pattern - Phase 1, 2, 3 & 4', () => {
  let player: YouTubePlayer;
  let mockElement: HTMLVideoElement;
  let mockContainer: HTMLElement;

  beforeAll(() => {
    // Use fake timers for interval testing
    jest.useFakeTimers();
  });

  afterAll(() => {
    // Restore real timers
    jest.useRealTimers();
  });

  beforeEach(() => {
    // Create mock elements
    mockElement = document.createElement('video') as HTMLVideoElement;
    mockContainer = document.createElement('div');
    
    // Store original methods for verification
    const originalPlay = mockElement.play;
    const originalPause = mockElement.pause;
    const originalLoad = mockElement.load;

    player = new YouTubePlayer(mockElement, mockContainer);

    // Verify original methods are backed up
    expect((player as any).originalMethods.play).toBeDefined();
    expect((player as any).originalMethods.pause).toBeDefined();
    expect((player as any).originalMethods.load).toBeDefined();
  });

  afterEach(() => {
    player.destroy();
  });

  test('should implement ElementProxy interface', () => {
    expect(typeof player.setupProxy).toBe('function');
    expect(typeof player.cleanupProxy).toBe('function');
  });

  test('should backup original HTMLMediaElement methods', () => {
    const originalMethods = (player as any).originalMethods;
    
    expect(originalMethods.play).toBeDefined();
    expect(originalMethods.pause).toBeDefined();
    expect(originalMethods.load).toBeDefined();
    expect(typeof originalMethods.play).toBe('function');
    expect(typeof originalMethods.pause).toBe('function');
    expect(typeof originalMethods.load).toBe('function');
  });

  test('should setup proxy without errors', () => {
    const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
    
    player.setupProxy();
    
    expect(consoleSpy).toHaveBeenCalledWith('YouTubePlayer: Proxy setup initiated');
    consoleSpy.mockRestore();
  });

  test('should cleanup proxy and restore original methods', () => {
    // Get references to original methods
    const originalPlay = mockElement.play;
    const originalPause = mockElement.pause;
    const originalLoad = mockElement.load;

    // Setup and then cleanup
    player.setupProxy();
    player.cleanupProxy();

    // Verify methods are restored (they should be the same references)
    expect(mockElement.play).toBe(originalPlay);
    expect(mockElement.pause).toBe(originalPause);
    expect(mockElement.load).toBe(originalLoad);
  });

  test('should initialize originalDescriptors Map', () => {
    const originalDescriptors = (player as any).originalDescriptors;
    
    expect(originalDescriptors).toBeInstanceOf(Map);
    expect(originalDescriptors.size).toBe(0); // Should start empty
  });

  test('should call cleanupProxy on destroy', () => {
    const cleanupSpy = jest.spyOn(player, 'cleanupProxy');
    
    player.destroy();
    
    expect(cleanupSpy).toHaveBeenCalled();
  });

  // Phase 2 Tests: Property Synchronization
  describe('Property Synchronization', () => {
    beforeEach(async () => {
      // Mock player instance with required methods
      const mockPlayerInstance = {
        destroy: jest.fn(),
        playVideo: jest.fn(),
        pauseVideo: jest.fn(),
        getCurrentTime: jest.fn(() => 123.45),
        getDuration: jest.fn(() => 300),
        getVolume: jest.fn(() => 75),
        setVolume: jest.fn(),
        isMuted: jest.fn(() => false),
        mute: jest.fn(),
        unMute: jest.fn(),
        getPlayerState: jest.fn(() => mockYouTubeAPI.PlayerState.PLAYING),
        getPlaybackRate: jest.fn(() => 1.5),
        setPlaybackRate: jest.fn(),
        seekTo: jest.fn(),
      };

      // Mock the YouTube API Player constructor
      mockYouTubeAPI.Player.mockImplementation(() => mockPlayerInstance);
      
      // Set up player instance
      (player as any).player = mockPlayerInstance;
      
      // Setup proxy
      player.setupProxy();
    });

    test('should proxy currentTime getter from YouTube player', () => {
      expect(mockElement.currentTime).toBe(123.45);
    });

    test('should proxy currentTime setter to YouTube player', () => {
      const mockPlayerInstance = (player as any).player;
      const dispatchSpy = jest.spyOn(mockElement, 'dispatchEvent');
      
      mockElement.currentTime = 60;
      
      expect(mockPlayerInstance.seekTo).toHaveBeenCalledWith(60, true);
      expect(dispatchSpy).toHaveBeenCalledWith(new Event('seeking'));
    });

    test('should proxy duration getter from YouTube player', () => {
      expect(mockElement.duration).toBe(300);
    });

    test('should proxy volume getter/setter from YouTube player', () => {
      const mockPlayerInstance = (player as any).player;
      const dispatchSpy = jest.spyOn(mockElement, 'dispatchEvent');
      
      // Test getter (75/100 = 0.75)
      expect(mockElement.volume).toBe(0.75);
      
      // Test setter
      mockElement.volume = 0.5;
      expect(mockPlayerInstance.setVolume).toHaveBeenCalledWith(50);
      expect(dispatchSpy).toHaveBeenCalledWith(new Event('volumechange'));
    });

    test('should proxy muted getter/setter from YouTube player', () => {
      const mockPlayerInstance = (player as any).player;
      const dispatchSpy = jest.spyOn(mockElement, 'dispatchEvent');
      
      // Test getter
      expect(mockElement.muted).toBe(false);
      
      // Test setter - mute
      mockElement.muted = true;
      expect(mockPlayerInstance.mute).toHaveBeenCalled();
      expect(dispatchSpy).toHaveBeenCalledWith(new Event('volumechange'));
      
      // Test setter - unmute
      mockElement.muted = false;
      expect(mockPlayerInstance.unMute).toHaveBeenCalled();
    });

    test('should proxy paused getter from YouTube player state', () => {
      const mockPlayerInstance = (player as any).player;
      
      // When playing, paused should be false
      mockPlayerInstance.getPlayerState.mockReturnValue(mockYouTubeAPI.PlayerState.PLAYING);
      expect(mockElement.paused).toBe(false);
      
      // When paused, paused should be true
      mockPlayerInstance.getPlayerState.mockReturnValue(mockYouTubeAPI.PlayerState.PAUSED);
      expect(mockElement.paused).toBe(true);
    });

    test('should proxy ended getter from YouTube player state', () => {
      const mockPlayerInstance = (player as any).player;
      
      // When playing, ended should be false
      mockPlayerInstance.getPlayerState.mockReturnValue(mockYouTubeAPI.PlayerState.PLAYING);
      expect(mockElement.ended).toBe(false);
      
      // When ended, ended should be true
      mockPlayerInstance.getPlayerState.mockReturnValue(mockYouTubeAPI.PlayerState.ENDED);
      expect(mockElement.ended).toBe(true);
    });

    test('should proxy playbackRate getter/setter from YouTube player', () => {
      const mockPlayerInstance = (player as any).player;
      const dispatchSpy = jest.spyOn(mockElement, 'dispatchEvent');
      
      // Test getter
      expect(mockElement.playbackRate).toBe(1.5);
      
      // Test setter
      mockElement.playbackRate = 2.0;
      expect(mockPlayerInstance.setPlaybackRate).toHaveBeenCalledWith(2.0);
      expect(dispatchSpy).toHaveBeenCalledWith(new Event('ratechange'));
    });

    test('should handle properties gracefully when player is not ready', () => {
      // Remove player instance
      (player as any).player = null;
      
      // Should return sensible defaults
      expect(mockElement.currentTime).toBe(0);
      expect(mockElement.duration).toBeNaN();
      expect(mockElement.volume).toBe(1.0);
      expect(mockElement.muted).toBe(false);
      expect(mockElement.paused).toBe(true);
      expect(mockElement.ended).toBe(false);
      expect(mockElement.playbackRate).toBe(1.0);
    });

    test('should backup and restore original property descriptors', () => {
      const originalDescriptors = (player as any).originalDescriptors;
      
      // Should have attempted to backup properties (may be 0 in test environment)
      expect(originalDescriptors).toBeInstanceOf(Map);
      
      // Test that properties are properly overridden
      const originalCurrentTime = mockElement.currentTime;
      expect(typeof originalCurrentTime).toBe('number');
      
      // Cleanup should restore and clear descriptors
      player.cleanupProxy();
      
      // Should be cleared
      expect(originalDescriptors.size).toBe(0);
    });
  });

  // Phase 3 Tests: Method Interception
  describe('Method Interception', () => {
    beforeEach(async () => {
      // Mock player instance with required methods
      const mockPlayerInstance = {
        destroy: jest.fn(),
        playVideo: jest.fn(),
        pauseVideo: jest.fn(),
        getCurrentTime: jest.fn(() => 0),
        getDuration: jest.fn(() => 0),
        getVolume: jest.fn(() => 100),
        setVolume: jest.fn(),
        isMuted: jest.fn(() => false),
        mute: jest.fn(),
        unMute: jest.fn(),
        getPlayerState: jest.fn(() => mockYouTubeAPI.PlayerState.PLAYING),
        getPlaybackRate: jest.fn(() => 1.0),
        setPlaybackRate: jest.fn(),
        seekTo: jest.fn(),
      };

      // Mock the YouTube API Player constructor
      mockYouTubeAPI.Player.mockImplementation(() => mockPlayerInstance);
      
      // Set up player instance
      (player as any).player = mockPlayerInstance;
      
      // Setup proxy
      player.setupProxy();
    });

    test('should intercept play() method and call YouTube player', async () => {
      const mockPlayerInstance = (player as any).player;
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
      
      await mockElement.play();
      
      expect(mockPlayerInstance.playVideo).toHaveBeenCalled();
      expect(consoleSpy).toHaveBeenCalledWith('YouTubePlayer: Intercepted play() call');
      
      consoleSpy.mockRestore();
    });

    test('should intercept pause() method and call YouTube player', () => {
      const mockPlayerInstance = (player as any).player;
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
      
      mockElement.pause();
      
      expect(mockPlayerInstance.pauseVideo).toHaveBeenCalled();
      expect(consoleSpy).toHaveBeenCalledWith('YouTubePlayer: Intercepted pause() call');
      
      consoleSpy.mockRestore();
    });

    test('should intercept load() method and reload YouTube video', () => {
      const mockPlayerInstance = (player as any).player;
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
      const loadSpy = jest.spyOn(player, 'load');
      
      // Set a source
      mockElement.src = 'https://youtube.com/watch?v=test';
      mockElement.load();
      
      expect(consoleSpy).toHaveBeenCalledWith('YouTubePlayer: Intercepted load() call');
      expect(loadSpy).toHaveBeenCalledWith('https://youtube.com/watch?v=test');
      
      consoleSpy.mockRestore();
      loadSpy.mockRestore();
    });

    test('should fallback to original methods when player not available', async () => {
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
      
      // Remove player instance
      (player as any).player = null;
      
      // Test play fallback
      await mockElement.play();
      expect(consoleSpy).toHaveBeenCalledWith('YouTubePlayer: No player available, using original play()');
      
      // Test pause fallback
      mockElement.pause();
      expect(consoleSpy).toHaveBeenCalledWith('YouTubePlayer: No player available, using original pause()');
      
      // Test load fallback
      mockElement.load();
      expect(consoleSpy).toHaveBeenCalledWith('YouTubePlayer: No player/src available, using original load()');
      
      consoleSpy.mockRestore();
    });

    test('should restore original methods on cleanup', () => {
      const originalPlay = (player as any).originalMethods.play;
      const originalPause = (player as any).originalMethods.pause;
      const originalLoad = (player as any).originalMethods.load;
      
      // Methods should be overridden
      expect(mockElement.play).not.toBe(originalPlay);
      expect(mockElement.pause).not.toBe(originalPause);
      expect(mockElement.load).not.toBe(originalLoad);
      
      // Cleanup should restore
      player.cleanupProxy();
      
      expect(mockElement.play).toBe(originalPlay);
      expect(mockElement.pause).toBe(originalPause);
      expect(mockElement.load).toBe(originalLoad);
    });
  });

  // Phase 4 Tests: Event System Refactoring
  describe('Event System Refactoring', () => {
    beforeEach(async () => {
      // Mock player instance with required methods
      const mockPlayerInstance = {
        destroy: jest.fn(),
        playVideo: jest.fn(),
        pauseVideo: jest.fn(),
        getCurrentTime: jest.fn(() => 0),
        getDuration: jest.fn(() => 0),
        getVolume: jest.fn(() => 100),
        setVolume: jest.fn(),
        isMuted: jest.fn(() => false),
        mute: jest.fn(),
        unMute: jest.fn(),
        getPlayerState: jest.fn(() => mockYouTubeAPI.PlayerState.PLAYING),
        getPlaybackRate: jest.fn(() => 1.0),
        setPlaybackRate: jest.fn(),
        seekTo: jest.fn(),
      };

      // Mock the YouTube API Player constructor
      mockYouTubeAPI.Player.mockImplementation(() => mockPlayerInstance);
      
      // Set up player instance
      (player as any).player = mockPlayerInstance;
      
      // Setup proxy
      player.setupProxy();
    });

    test('should dispatch events on nativeEl instead of container', () => {
      const elementSpy = jest.spyOn(mockElement, 'dispatchEvent');
      const containerSpy = jest.spyOn(mockContainer, 'dispatchEvent');
      
      // Trigger state change to PLAYING
      const onStateChange = (player as any).onPlayerStateChange.bind(player);
      onStateChange({ data: mockYouTubeAPI.PlayerState.PLAYING });
      
      // Should dispatch on element, not container
      expect(elementSpy).toHaveBeenCalledWith(new Event('play'));
      expect(elementSpy).toHaveBeenCalledWith(new Event('playing'));
      expect(containerSpy).not.toHaveBeenCalledWith(new Event('play'));
      expect(containerSpy).not.toHaveBeenCalledWith(new Event('playing'));
    });

    test('should dispatch lifecycle events on nativeEl', () => {
      const elementSpy = jest.spyOn(mockElement, 'dispatchEvent');
      
      // Trigger ready event
      const onPlayerReady = (player as any).onPlayerReady.bind(player);
      onPlayerReady();
      
      // Should dispatch readiness events on element
      expect(elementSpy).toHaveBeenCalledWith(new Event('loadedmetadata'));
      expect(elementSpy).toHaveBeenCalledWith(new Event('durationchange'));
      expect(elementSpy).toHaveBeenCalledWith(new Event('volumechange'));
      expect(elementSpy).toHaveBeenCalledWith(new Event('canplay'));
      expect(elementSpy).toHaveBeenCalledWith(new Event('canplaythrough'));
    });

    test('should dispatch load events on nativeEl', () => {
      const elementSpy = jest.spyOn(mockElement, 'dispatchEvent');
      
      // Trigger load
      player.load('https://youtube.com/watch?v=test');
      
      // Should dispatch load events on element
      expect(elementSpy).toHaveBeenCalledWith(new Event('emptied'));
      expect(elementSpy).toHaveBeenCalledWith(new Event('loadstart'));
    });

    test('should dispatch timeupdate events on nativeEl', () => {
      const elementSpy = jest.spyOn(mockElement, 'dispatchEvent');
      
      // Start time updates
      const startTimeUpdate = (player as any).startTimeUpdate.bind(player);
      startTimeUpdate();
      
      // Wait for interval to trigger
      jest.advanceTimersByTime(250);
      
      expect(elementSpy).toHaveBeenCalledWith(new Event('timeupdate'));
      
      // Stop intervals to prevent test interference
      const stopTimeUpdate = (player as any).stopTimeUpdate.bind(player);
      stopTimeUpdate();
    });

    test('should dispatch playback rate change events on nativeEl', () => {
      const elementSpy = jest.spyOn(mockElement, 'dispatchEvent');
      
      // Trigger rate change
      const onPlaybackRateChange = (player as any).onPlaybackRateChange.bind(player);
      onPlaybackRateChange({ data: 1.5 });
      
      expect(elementSpy).toHaveBeenCalledWith(new Event('ratechange'));
    });

    test('should dispatch state change events on nativeEl', () => {
      const elementSpy = jest.spyOn(mockElement, 'dispatchEvent');
      const onStateChange = (player as any).onPlayerStateChange.bind(player);
      
      // Test PAUSED state
      onStateChange({ data: mockYouTubeAPI.PlayerState.PAUSED });
      expect(elementSpy).toHaveBeenCalledWith(new Event('pause'));
      
      // Test ENDED state  
      onStateChange({ data: mockYouTubeAPI.PlayerState.ENDED });
      expect(elementSpy).toHaveBeenCalledWith(new Event('ended'));
      
      // Test BUFFERING state
      onStateChange({ data: mockYouTubeAPI.PlayerState.BUFFERING });
      expect(elementSpy).toHaveBeenCalledWith(new Event('waiting'));
    });
  });
});