import {
  BadRequestException,
  UnsupportedMediaTypeException,
} from '@nestjs/common';
import { basename, isAbsolute, relative, resolve, sep } from 'node:path';
import { randomBytes } from 'node:crypto';
import {
  isSafeMediaMimeType,
  SAFE_MEDIA_TYPES,
  SafeMediaDefinition,
  SafeMediaMimeType,
} from './media-types';

export function requireSafeMediaType(mimeType: string): SafeMediaDefinition {
  const normalized = mimeType.trim().toLowerCase();
  if (!isSafeMediaMimeType(normalized)) {
    throw new UnsupportedMediaTypeException(
      'Sólo se permiten JPEG, PNG, WebP, MP4 y WebM',
    );
  }
  return SAFE_MEDIA_TYPES[normalized];
}

export function assertMediaSignature(
  mimeType: string,
  header: Buffer,
): SafeMediaDefinition {
  const definition = requireSafeMediaType(mimeType);
  const normalized = mimeType.trim().toLowerCase() as SafeMediaMimeType;
  const valid =
    normalized === 'image/jpeg'
      ? header.length >= 3 &&
        header[0] === 0xff &&
        header[1] === 0xd8 &&
        header[2] === 0xff
      : normalized === 'image/png'
        ? header.length >= 8 &&
          header
            .subarray(0, 8)
            .equals(
              Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
            )
        : normalized === 'image/webp'
          ? header.length >= 12 &&
            header.subarray(0, 4).toString('ascii') === 'RIFF' &&
            header.subarray(8, 12).toString('ascii') === 'WEBP'
          : normalized === 'video/mp4'
            ? header.length >= 12 &&
              header.subarray(4, 8).toString('ascii') === 'ftyp'
            : header.length >= 4 &&
              header
                .subarray(0, 4)
                .equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]));

  if (!valid) {
    throw new UnsupportedMediaTypeException(
      'El contenido del archivo no coincide con su MIME permitido',
    );
  }
  return definition;
}

/** El nombre original es sólo metadata y nunca participa en una ruta. */
export function sanitizeOriginalFilename(value: string): string {
  const leaf = basename(value.replace(/\\/g, '/')).normalize('NFKC');
  const sanitized = leaf
    .replace(/[\u0000-\u001f\u007f<>:"|?*]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 180);
  return sanitized || 'upload';
}

export function assertPathWithinRoot(root: string, candidate: string): string {
  const absoluteRoot = resolve(root);
  const absoluteCandidate = resolve(candidate);
  const pathFromRoot = relative(absoluteRoot, absoluteCandidate);
  if (
    pathFromRoot === '..' ||
    pathFromRoot.startsWith(`..${sep}`) ||
    isAbsolute(pathFromRoot) ||
    absoluteCandidate === absoluteRoot
  ) {
    throw new BadRequestException('Ruta de archivo inválida');
  }
  return absoluteCandidate;
}

export function assertSafeStorageKey(key: string): string {
  if (
    !key ||
    key.includes('\0') ||
    key.includes('\\') ||
    isAbsolute(key) ||
    key
      .split('/')
      .some((segment) => !segment || segment === '.' || segment === '..') ||
    !/^[A-Za-z0-9._/-]+$/.test(key)
  ) {
    throw new BadRequestException('Clave de almacenamiento inválida');
  }
  return key;
}

export function resolveStoragePath(root: string, key: string): string {
  const safeKey = assertSafeStorageKey(key);
  return assertPathWithinRoot(root, resolve(root, safeKey));
}

export function createCryptographicUploadName(): string {
  return `${randomBytes(24).toString('hex')}.upload`;
}

export function createMediaStorageKey(
  mimeType: string,
  now = new Date(),
): string {
  const { extension } = requireSafeMediaType(mimeType);
  const year = String(now.getUTCFullYear());
  const month = String(now.getUTCMonth() + 1).padStart(2, '0');
  return `${year}/${month}/${randomBytes(24).toString('hex')}.${extension}`;
}
