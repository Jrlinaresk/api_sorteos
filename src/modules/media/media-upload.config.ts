import { UnsupportedMediaTypeException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MulterModuleOptions } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import {
  createCryptographicUploadName,
  requireSafeMediaType,
} from './media-security';

export const DEFAULT_MAX_IMAGE_BYTES = 10 * 1024 * 1024;
export const DEFAULT_MAX_VIDEO_BYTES = 250 * 1024 * 1024;
const MAX_CONFIGURABLE_BYTES = 2 * 1024 * 1024 * 1024;
export const DEFAULT_MAX_TOTAL_STORED_BYTES = 50 * 1024 * 1024 * 1024;
export const DEFAULT_MAX_STORED_BYTES_PER_USER = 10 * 1024 * 1024 * 1024;
export const DEFAULT_DELETED_RETENTION_DAYS = 30;
const MAX_CONFIGURABLE_STORAGE_BYTES = 10 * 1024 * 1024 * 1024 * 1024;

interface ConfigurationReader {
  get<T = unknown>(key: string): T | undefined;
}

export interface MediaUploadLimits {
  imageBytes: number;
  videoBytes: number;
}

export interface MediaStoragePolicy {
  maxTotalBytes: number;
  maxBytesPerUser: number;
  deletedRetentionDays: number;
}

function configuredPositiveInteger(
  config: ConfigurationReader,
  key: string,
  fallback: number,
): number {
  const raw = config.get<string | number>(key);
  if (raw === undefined || raw === '') return fallback;
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) &&
    parsed > 0 &&
    parsed <= MAX_CONFIGURABLE_BYTES
    ? parsed
    : fallback;
}

export function getMediaUploadLimits(
  config: ConfigurationReader,
): MediaUploadLimits {
  return {
    imageBytes: configuredPositiveInteger(
      config,
      'MEDIA_MAX_IMAGE_BYTES',
      DEFAULT_MAX_IMAGE_BYTES,
    ),
    videoBytes: configuredPositiveInteger(
      config,
      'MEDIA_MAX_VIDEO_BYTES',
      DEFAULT_MAX_VIDEO_BYTES,
    ),
  };
}

export function getMediaStoragePolicy(
  config: ConfigurationReader,
): MediaStoragePolicy {
  return {
    maxTotalBytes: configuredStorageInteger(
      config,
      'MEDIA_MAX_TOTAL_STORED_BYTES',
      DEFAULT_MAX_TOTAL_STORED_BYTES,
    ),
    maxBytesPerUser: configuredStorageInteger(
      config,
      'MEDIA_MAX_STORED_BYTES_PER_USER',
      DEFAULT_MAX_STORED_BYTES_PER_USER,
    ),
    deletedRetentionDays: configuredBoundedInteger(
      config,
      'MEDIA_DELETED_RETENTION_DAYS',
      DEFAULT_DELETED_RETENTION_DAYS,
      1,
      3_650,
    ),
  };
}

export function getMediaUploadTempRoot(config: ConfigurationReader): string {
  const configured = config.get<string>('MEDIA_UPLOAD_TMP_DIR');
  return resolve(configured?.trim() || resolve(tmpdir(), 'api-sorteos-media'));
}

export function getMediaStorageRoot(config: ConfigurationReader): string {
  const configured = config.get<string>('MEDIA_LOCAL_ROOT');
  return resolve(configured?.trim() || resolve(process.cwd(), 'uploads/media'));
}

export function createMediaMulterOptions(
  config: ConfigService,
): MulterModuleOptions {
  const tempRoot = getMediaUploadTempRoot(config);
  const limits = getMediaUploadLimits(config);
  mkdirSync(tempRoot, { recursive: true, mode: 0o700 });

  return {
    storage: diskStorage({
      destination: tempRoot,
      filename: (_request, _file, callback) =>
        callback(null, createCryptographicUploadName()),
    }),
    fileFilter: (_request, file, callback) => {
      try {
        requireSafeMediaType(file.mimetype);
        callback(null, true);
      } catch {
        callback(
          new UnsupportedMediaTypeException(
            'Sólo se permiten JPEG, PNG, WebP, MP4 y WebM',
          ),
          false,
        );
      }
    },
    limits: {
      fileSize: Math.max(limits.imageBytes, limits.videoBytes),
      files: 1,
      fields: 10,
      parts: 11,
      fieldNameSize: 100,
      fieldSize: 16 * 1024,
    },
    preservePath: false,
  };
}

function configuredStorageInteger(
  config: ConfigurationReader,
  key: string,
  fallback: number,
): number {
  return configuredBoundedInteger(
    config,
    key,
    fallback,
    1,
    MAX_CONFIGURABLE_STORAGE_BYTES,
  );
}

function configuredBoundedInteger(
  config: ConfigurationReader,
  key: string,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const raw = config.get<string | number>(key);
  if (raw === undefined || raw === '') return fallback;
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) && parsed >= minimum && parsed <= maximum
    ? parsed
    : fallback;
}
