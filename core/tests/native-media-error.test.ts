import { describe, it, expect } from '@jest/globals';
import { mapNativeMediaError } from '../src/players/native-media-error';

function fakeMediaError(code: number, message = ''): MediaError {
  return { code, message, MEDIA_ERR_ABORTED: 1, MEDIA_ERR_NETWORK: 2, MEDIA_ERR_DECODE: 3, MEDIA_ERR_SRC_NOT_SUPPORTED: 4 } as MediaError;
}

describe('mapNativeMediaError', () => {
  it('maps MEDIA_ERR_SRC_NOT_SUPPORTED (e.g. a 404) to fatal:true / category:mediaError, no status', () => {
    const error = mapNativeMediaError(fakeMediaError(4), 'video/mp4', 'https://example.com/missing.mp4');

    expect(error).toEqual({
      fatal: true,
      category: 'mediaError',
      code: 'MEDIA_ERR_SRC_NOT_SUPPORTED',
      message: 'MEDIA_ERR_SRC_NOT_SUPPORTED',
      engine: 'video/mp4',
      url: 'https://example.com/missing.mp4',
      cause: expect.any(Object),
    });
    expect(error.status).toBeUndefined();
  });

  it('maps MEDIA_ERR_NETWORK to category:networkError, and keeps the engine tag it was given', () => {
    const error = mapNativeMediaError(fakeMediaError(2, 'connection lost'), 'audio/mp3', 'https://example.com/a.mp3');

    expect(error.fatal).toBe(true);
    expect(error.category).toBe('networkError');
    expect(error.message).toBe('connection lost');
    expect(error.engine).toBe('audio/mp3');
  });

  it('falls back to otherError for an unset/unknown MediaError', () => {
    const error = mapNativeMediaError(null, 'video/mp4', '');

    expect(error.category).toBe('otherError');
    expect(error.fatal).toBe(true);
    expect(error.url).toBeUndefined();
  });
});
