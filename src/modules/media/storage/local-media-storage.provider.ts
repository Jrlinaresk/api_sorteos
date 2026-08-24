import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { constants, createReadStream } from 'node:fs';
import { lstat, mkdir, open, unlink } from 'node:fs/promises';
import { dirname } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { resolveStoragePath } from '../media-security';
import { getMediaStorageRoot } from '../media-upload.config';
import {
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

  async open(key: string): Promise<OpenedMediaObject> {
    const path = resolveStoragePath(this.root, key);
    const noFollow = constants.O_NOFOLLOW ?? 0;
    const handle = await open(path, constants.O_RDONLY | noFollow);
    try {
      const stat = await handle.stat();
      if (!stat.isFile()) throw new Error('El objeto no es un archivo regular');
      return {
        stream: handle.createReadStream({ autoClose: true }),
        size: stat.size,
        lastModified: stat.mtime,
      };
    } catch (error) {
      await handle.close();
      throw error;
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
