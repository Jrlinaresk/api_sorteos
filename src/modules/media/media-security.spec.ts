import {
  BadRequestException,
  UnsupportedMediaTypeException,
} from '@nestjs/common';
import {
  assertMediaSignature,
  assertPathWithinRoot,
  assertSafeStorageKey,
  createCryptographicUploadName,
  createMediaStorageKey,
  requireSafeMediaType,
  sanitizeOriginalFilename,
} from './media-security';
import {
  DEFAULT_DELETED_RETENTION_DAYS,
  DEFAULT_MAX_IMAGE_BYTES,
  DEFAULT_MAX_STORED_BYTES_PER_USER,
  DEFAULT_MAX_TOTAL_STORED_BYTES,
  DEFAULT_MAX_VIDEO_BYTES,
  getMediaStoragePolicy,
  getMediaUploadLimits,
} from './media-upload.config';

describe('media security', () => {
  it('never permits executable SVG or HTML media', () => {
    expect(() => requireSafeMediaType('image/svg+xml')).toThrow(
      UnsupportedMediaTypeException,
    );
    expect(() => requireSafeMediaType('text/html')).toThrow(
      UnsupportedMediaTypeException,
    );
  });

  it.each([
    ['image/jpeg', Buffer.from([0xff, 0xd8, 0xff, 0xe0])],
    [
      'image/png',
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    ],
    ['image/webp', Buffer.from('RIFF0000WEBP', 'ascii')],
    ['video/mp4', Buffer.from('0000ftypisom', 'ascii')],
    ['video/webm', Buffer.from([0x1a, 0x45, 0xdf, 0xa3])],
  ])('accepts a valid %s signature', (mimeType, header) => {
    expect(assertMediaSignature(mimeType, header).extension).toBeTruthy();
  });

  it('rejects a MIME that does not match the bytes', () => {
    expect(() =>
      assertMediaSignature(
        'image/png',
        Buffer.from('<html><script>alert(1)</script></html>'),
      ),
    ).toThrow(UnsupportedMediaTypeException);
  });

  it('normalizes an original name without using its path', () => {
    const name = sanitizeOriginalFilename('..\\..\\secret/<script>:photo.png');
    expect(name).toBe('_script__photo.png');
    expect(name).not.toMatch(/[\\/<>:]/);
  });

  it('rejects traversal and sibling-prefix path tricks', () => {
    expect(() => assertPathWithinRoot('/srv/media', '/srv/secret')).toThrow(
      BadRequestException,
    );
    expect(() =>
      assertPathWithinRoot('/srv/media', '/srv/media-evil/x'),
    ).toThrow(BadRequestException);
    expect(assertPathWithinRoot('/srv/media', '/srv/media/a/b')).toBe(
      '/srv/media/a/b',
    );
  });

  it.each(['../secret', '/absolute/file', 'a\\..\\secret', 'a//b', ''])(
    'rejects unsafe storage key %p',
    (key) => {
      expect(() => assertSafeStorageKey(key)).toThrow(BadRequestException);
    },
  );

  it('generates opaque cryptographic names and storage keys', () => {
    const first = createCryptographicUploadName();
    const second = createCryptographicUploadName();
    expect(first).toMatch(/^[a-f0-9]{48}\.upload$/);
    expect(second).not.toBe(first);
    expect(createMediaStorageKey('image/jpeg', new Date('2026-08-24'))).toMatch(
      /^2026\/08\/[a-f0-9]{48}\.jpg$/,
    );
  });

  it('uses safe defaults for invalid configured limits', () => {
    const config = {
      get: <T>(key: string): T | undefined =>
        (key === 'MEDIA_MAX_IMAGE_BYTES'
          ? '-1'
          : 'not-a-number') as unknown as T,
    };
    expect(getMediaUploadLimits(config)).toEqual({
      imageBytes: DEFAULT_MAX_IMAGE_BYTES,
      videoBytes: DEFAULT_MAX_VIDEO_BYTES,
    });
    expect(getMediaStoragePolicy(config)).toEqual({
      maxTotalBytes: DEFAULT_MAX_TOTAL_STORED_BYTES,
      maxBytesPerUser: DEFAULT_MAX_STORED_BYTES_PER_USER,
      deletedRetentionDays: DEFAULT_DELETED_RETENTION_DAYS,
    });
  });
});
