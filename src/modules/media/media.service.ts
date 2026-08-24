import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, open, unlink } from 'node:fs/promises';
import { Model, Types } from 'mongoose';
import {
  assertMediaSignature,
  assertPathWithinRoot,
  createMediaStorageKey,
  sanitizeOriginalFilename,
} from './media-security';
import {
  getMediaUploadLimits,
  getMediaUploadTempRoot,
} from './media-upload.config';
import { MediaAssetView, toMediaAssetView } from './media.presenter';
import { MediaKind } from './media-types';
import {
  MediaAsset,
  MediaAssetDocument,
  MediaAssetStatus,
} from './schemas/media-asset.schema';
import {
  MEDIA_STORAGE_PROVIDER,
  MediaStorageProvider,
  OpenedMediaObject,
} from './storage/media-storage.provider';

export interface PublicMediaObject {
  asset: MediaAssetView;
  object: OpenedMediaObject;
  etag: string;
}

@Injectable()
export class MediaService {
  private readonly logger = new Logger(MediaService.name);
  private readonly tempRoot: string;
  private readonly maxImageBytes: number;
  private readonly maxVideoBytes: number;

  constructor(
    @InjectModel(MediaAsset.name)
    private readonly mediaModel: Model<MediaAssetDocument>,
    @Inject(MEDIA_STORAGE_PROVIDER)
    private readonly storage: MediaStorageProvider,
    config: ConfigService,
  ) {
    this.tempRoot = getMediaUploadTempRoot(config);
    const limits = getMediaUploadLimits(config);
    this.maxImageBytes = limits.imageBytes;
    this.maxVideoBytes = limits.videoBytes;
  }

  async createFromUpload(
    file: Express.Multer.File,
    actorUserId: string,
  ): Promise<MediaAssetView> {
    if (!file?.path) throw new BadRequestException('Archivo obligatorio');
    const actor = this.toObjectId(actorUserId, 'usuario');
    const tempPath = assertPathWithinRoot(this.tempRoot, file.path);

    try {
      const stat = await lstat(tempPath);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size < 1) {
        throw new BadRequestException('El upload no es un archivo regular');
      }

      const header = await this.readHeader(tempPath);
      const definition = assertMediaSignature(file.mimetype, header);
      const maximum =
        definition.kind === MediaKind.Image
          ? this.maxImageBytes
          : this.maxVideoBytes;
      if (stat.size > maximum) {
        throw new BadRequestException(
          `El archivo supera el límite de ${maximum} bytes`,
        );
      }

      const checksumSha256 = await this.hashFile(tempPath);
      const storageKey = createMediaStorageKey(file.mimetype);
      const stored = await this.storage.put({
        sourcePath: tempPath,
        key: storageKey,
        contentType: file.mimetype,
      });

      try {
        const asset = await this.mediaModel.create({
          storageProvider: this.storage.providerName,
          storageKey: stored.key,
          originalName: sanitizeOriginalFilename(file.originalname),
          mimeType: file.mimetype.toLowerCase(),
          kind: definition.kind,
          extension: definition.extension,
          size: stored.size,
          checksumSha256,
          uploadedBy: actor,
          references: [],
        });
        return toMediaAssetView(asset);
      } catch (error) {
        await this.storage.delete(stored.key).catch(() => undefined);
        throw error;
      }
    } finally {
      await this.safeUnlink(tempPath);
    }
  }

  async openPublic(id: string): Promise<PublicMediaObject> {
    const _id = this.toObjectId(id, 'medio');
    const asset = await this.mediaModel
      .findOne({ _id, status: MediaAssetStatus.Active })
      .lean()
      .exec();
    if (!asset || asset.storageProvider !== this.storage.providerName) {
      throw new NotFoundException('Medio no encontrado');
    }

    try {
      const object = await this.storage.open(asset.storageKey);
      if (object.size !== asset.size) {
        object.stream.destroy();
        throw new Error('Tamaño de objeto inconsistente');
      }
      return {
        asset: toMediaAssetView(asset as MediaAsset),
        object,
        etag: `"sha256-${asset.checksumSha256}"`,
      };
    } catch {
      throw new NotFoundException('Medio no disponible');
    }
  }

  /** Soft delete atómico: una referencia concurrente impide el borrado. */
  async softDelete(id: string, actorUserId: string) {
    const _id = this.toObjectId(id, 'medio');
    const actor = this.toObjectId(actorUserId, 'usuario');
    const deletedAt = new Date();
    const asset = await this.mediaModel
      .findOneAndUpdate(
        {
          _id,
          status: MediaAssetStatus.Active,
          references: { $size: 0 },
        },
        {
          $set: {
            status: MediaAssetStatus.Deleted,
            deletedAt,
            deletedBy: actor,
          },
        },
        { new: true },
      )
      .exec();

    if (asset) return { id: asset.id, deleted: true, deletedAt };
    const existing = await this.mediaModel
      .findById(_id)
      .select('status references deletedAt')
      .lean()
      .exec();
    if (!existing) throw new NotFoundException('Medio no encontrado');
    if (existing.status === MediaAssetStatus.Deleted) {
      return { id, deleted: true, deletedAt: existing.deletedAt };
    }
    if (existing.references?.length) {
      throw new ConflictException('El medio todavía está referenciado');
    }
    throw new ConflictException('El medio cambió concurrentemente');
  }

  /** API interna para que campañas/premios protejan medios en uso. */
  async addReference(id: string, reference: string): Promise<MediaAssetView> {
    const _id = this.toObjectId(id, 'medio');
    const safeReference = this.validateReference(reference);
    const asset = await this.mediaModel
      .findOneAndUpdate(
        { _id, status: MediaAssetStatus.Active },
        { $addToSet: { references: safeReference } },
        { new: true },
      )
      .exec();
    if (!asset) throw new NotFoundException('Medio activo no encontrado');
    return toMediaAssetView(asset);
  }

  async removeReference(
    id: string,
    reference: string,
  ): Promise<MediaAssetView> {
    const _id = this.toObjectId(id, 'medio');
    const safeReference = this.validateReference(reference);
    const asset = await this.mediaModel
      .findOneAndUpdate(
        { _id, status: MediaAssetStatus.Active },
        { $pull: { references: safeReference } },
        { new: true },
      )
      .exec();
    if (!asset) throw new NotFoundException('Medio activo no encontrado');
    return toMediaAssetView(asset);
  }

  private async readHeader(path: string): Promise<Buffer> {
    const handle = await open(path, 'r');
    try {
      const buffer = Buffer.alloc(64);
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
      return buffer.subarray(0, bytesRead);
    } finally {
      await handle.close();
    }
  }

  private async hashFile(path: string): Promise<string> {
    const hash = createHash('sha256');
    for await (const chunk of createReadStream(path)) {
      hash.update(chunk as Buffer);
    }
    return hash.digest('hex');
  }

  private async safeUnlink(path: string): Promise<void> {
    try {
      await unlink(path);
    } catch (error) {
      if (!this.isNotFound(error)) {
        this.logger.warn('No se pudo limpiar un upload temporal');
      }
    }
  }

  private validateReference(value: string): string {
    const reference = value.trim();
    if (
      !/^[a-z][a-z0-9_-]{1,31}:[A-Za-z0-9][A-Za-z0-9._-]{0,159}$/.test(
        reference,
      )
    ) {
      throw new BadRequestException('Referencia de medio inválida');
    }
    return reference;
  }

  private toObjectId(value: string, label: string): Types.ObjectId {
    if (!Types.ObjectId.isValid(value)) {
      throw new BadRequestException(`ID de ${label} inválido`);
    }
    return new Types.ObjectId(value);
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
