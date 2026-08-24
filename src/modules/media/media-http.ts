export interface MediaByteRange {
  start: number;
  end: number;
  length: number;
}

export class InvalidMediaRangeError extends Error {
  constructor() {
    super('Rango de bytes no satisfacible');
    this.name = InvalidMediaRangeError.name;
  }
}

/**
 * Interpreta un único byte-range RFC 9110. Los rangos múltiples se rechazan
 * deliberadamente porque este endpoint no genera respuestas multipart/byteranges.
 */
export function parseSingleByteRange(
  header: string | undefined,
  size: number,
): MediaByteRange | undefined {
  if (header === undefined) return undefined;
  if (!Number.isSafeInteger(size) || size < 1) {
    throw new InvalidMediaRangeError();
  }

  const match = /^bytes=(\d*)-(\d*)$/i.exec(header.trim());
  if (!match || (match[1] === '' && match[2] === '')) {
    throw new InvalidMediaRangeError();
  }

  let start: number;
  let end: number;
  if (match[1] === '') {
    const suffixLength = parseSafeInteger(match[2]);
    if (suffixLength < 1) throw new InvalidMediaRangeError();
    start = Math.max(0, size - suffixLength);
    end = size - 1;
  } else {
    start = parseSafeInteger(match[1]);
    if (start >= size) throw new InvalidMediaRangeError();
    end = match[2] === '' ? size - 1 : parseSafeInteger(match[2]);
    if (end < start) throw new InvalidMediaRangeError();
    end = Math.min(end, size - 1);
  }

  return { start, end, length: end - start + 1 };
}

/** Comparación débil apropiada para If-None-Match en GET/HEAD. */
export function ifNoneMatchMatches(
  header: string | undefined,
  currentEtag: string,
): boolean {
  if (!header) return false;
  return header
    .split(',')
    .map((candidate) => candidate.trim())
    .some(
      (candidate) =>
        candidate === '*' || normalizeWeakEtag(candidate) === currentEtag,
    );
}

function parseSafeInteger(value: string): number {
  if (!/^\d+$/.test(value)) throw new InvalidMediaRangeError();
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new InvalidMediaRangeError();
  return parsed;
}

function normalizeWeakEtag(value: string): string {
  return value.startsWith('W/') ? value.slice(2) : value;
}
