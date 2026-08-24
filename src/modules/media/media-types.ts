export enum MediaKind {
  Image = 'image',
  Video = 'video',
}

export const SAFE_MEDIA_TYPES = {
  'image/jpeg': { extension: 'jpg', kind: MediaKind.Image },
  'image/png': { extension: 'png', kind: MediaKind.Image },
  'image/webp': { extension: 'webp', kind: MediaKind.Image },
  'video/mp4': { extension: 'mp4', kind: MediaKind.Video },
  'video/webm': { extension: 'webm', kind: MediaKind.Video },
} as const;

export type SafeMediaMimeType = keyof typeof SAFE_MEDIA_TYPES;

export interface SafeMediaDefinition {
  extension: string;
  kind: MediaKind;
}

export function isSafeMediaMimeType(value: string): value is SafeMediaMimeType {
  return Object.prototype.hasOwnProperty.call(SAFE_MEDIA_TYPES, value);
}
