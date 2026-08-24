import {
  ifNoneMatchMatches,
  InvalidMediaRangeError,
  parseSingleByteRange,
} from './media-http';

describe('media HTTP helpers', () => {
  it.each([
    ['bytes=0-9', { start: 0, end: 9, length: 10 }],
    ['bytes=4-', { start: 4, end: 9, length: 6 }],
    ['bytes=-3', { start: 7, end: 9, length: 3 }],
    ['bytes=-99', { start: 0, end: 9, length: 10 }],
    ['bytes=8-99', { start: 8, end: 9, length: 2 }],
    ['BYTES=1-1', { start: 1, end: 1, length: 1 }],
  ])('parses %s as one bounded range', (header, expected) => {
    expect(parseSingleByteRange(header, 10)).toEqual(expected);
  });

  it.each([
    'bytes=10-20',
    'bytes=5-4',
    'bytes=-0',
    'bytes=',
    'bytes=0-1,4-5',
    'items=0-1',
    'bytes=999999999999999999999-',
  ])('rejects the invalid or unsupported range %s', (header) => {
    expect(() => parseSingleByteRange(header, 10)).toThrow(
      InvalidMediaRangeError,
    );
  });

  it('supports wildcard, lists and weak ETags for If-None-Match', () => {
    const etag = '"sha256-current"';
    expect(ifNoneMatchMatches('*', etag)).toBe(true);
    expect(ifNoneMatchMatches('"old", W/"sha256-current"', etag)).toBe(true);
    expect(ifNoneMatchMatches('"old"', etag)).toBe(false);
    expect(ifNoneMatchMatches(undefined, etag)).toBe(false);
  });
});
