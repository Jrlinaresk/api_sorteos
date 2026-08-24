import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { constants, createReadStream } from 'node:fs';
import { lstat, mkdir, open, unlink } from 'node:fs/promises';
import { dirname } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { resolveStoragePath } from '../media-security';
import { getMediaStorageRoot } from '../media-upload.config';
import {
  MediaObjectMetadata,
  MediaObjectRange,
  MediaStorageProvider,
  OpenedMediaObject,
  StoredMediaObject,
  StoreMediaObjectInput,
} from './media-storage.provider';

@Injectable()
export class LocalMediaStorageProvider implements MediaStorageProvider {
  readonly providerName = 'local';
  private readonly root: string;

  constructor(config: ConfigService) {
    this.root = getMediaStorageRoot(config);
  }

  async put(input: StoreMediaObjectInput): Promise<StoredMediaObject> {
    const source = await lstat(input.sourcePath);
    if (!source.isFile() || source.isSymbolicLink()) {
      throw new Error('El origen del medio no es un archivo regular');
    }
    const destination = resolveStoragePath(this.root, input.key);
    await mkdir(dirname(destination), { recursive: true, mode: 0o750 });
    let destinationCreated = false;
    try {
      const destinationHandle = await open(destination, 'wx', 0o640);
      destinationCreated = true;
      await pipeline(
        createReadStream(input.sourcePath),
        destinationHandle.createWriteStream({ autoClose: true }),
      );
    } catch (error) {
      if (destinationCreated) {
        await unlink(destination).catch(() => undefined);
      }
      throw error;
    }
    return { key: input.key, size: source.size };
  }

  async stat(key: string): Promise<MediaObjectMetadata> {
    const handle = await this.openRegularObject(key);
    try {
      const stat = await handle.stat();
      return { size: stat.size, lastModified: stat.mtime };
    } finally {
      await handle.close();
    }
  }

  async open(
    key: string,
    range?: MediaObjectRange,
  ): Promise<OpenedMediaObject> {
    const handle = await this.openRegularObject(key);
    try {
      const stat = await handle.stat();
      this.assertRange(range, stat.size);
      const contentLength = range ? range.end - range.start + 1 : stat.size;
      const stream = handle.createReadStream({
        autoClose: true,
        ...(range ? { start: range.start, end: range.end } : {}),
      });
      return {
        stream,
        size: stat.size,
        contentLength,
        lastModified: stat.mtime,
      };
    } catch (error) {
      await handle.close();
      throw error;
    }
  }

  private async openRegularObject(key: string) {
    const path = resolveStoragePath(this.root, key);
    const noFollow = constants.O_NOFOLLOW ?? 0;
    const handle = await open(path, constants.O_RDONLY | noFollow);
    try {
      const stat = await handle.stat();
      if (!stat.isFile()) throw new Error('El objeto no es un archivo regular');
      return handle;
    } catch (error) {
      await handle.close();
      throw error;
    }
  }

  private assertRange(range: MediaObjectRange | undefined, size: number): void {
    if (!range) return;
    if (
      !Number.isSafeInteger(range.start) ||
      !Number.isSafeInteger(range.end) ||
      range.start < 0 ||
      range.end < range.start ||
      range.end >= size
    ) {
      throw new Error('Rango de objeto inválido');
    }
  }

  async delete(key: string): Promise<void> {
    const path = resolveStoragePath(this.root, key);
    try {
      await unlink(path);
    } catch (error) {
      if (!this.isNotFound(error)) throw error;
    }
  }

  private isNotFound(error: unknown): boolean {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      (error as { code?: string }).code === 'ENOENT'
    );
  }
}
