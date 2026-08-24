import { Readable } from 'node:stream';

export const MEDIA_STORAGE_PROVIDER = Symbol('MEDIA_STORAGE_PROVIDER');

export interface StoreMediaObjectInput {
  sourcePath: string;
  key: string;
  contentType: string;
}

export interface StoredMediaObject {
  key: string;
  size: number;
  etag?: string;
}

export interface MediaObjectMetadata {
  size: number;
  etag?: string;
  lastModified?: Date;
}

export interface MediaObjectRange {
  start: number;
  end: number;
}

export interface OpenedMediaObject extends MediaObjectMetadata {
  stream: Readable;
  contentLength: number;
}

/** Implementable con disco local, S3, R2 u otro object storage. */
export interface MediaStorageProvider {
  readonly providerName: string;
  put(input: StoreMediaObjectInput): Promise<StoredMediaObject>;
  stat(key: string): Promise<MediaObjectMetadata>;
  open(key: string, range?: MediaObjectRange): Promise<OpenedMediaObject>;
  delete(key: string): Promise<void>;
}
