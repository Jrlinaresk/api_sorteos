import {
  BadRequestException,
  ConflictException,
  HttpException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, open, unlink } from 'node:fs/promises';
import { FilterQuery, Model, Types } from 'mongoose';
import { ListMediaAssetsDto } from './dto/list-media-assets.dto';
import {
  assertMediaSignature,
  assertPathWithinRoot,
  createMediaStorageKey,
  sanitizeOriginalFilename,
} from './media-security';
import {
  getMediaUploadLimits,
  getMediaUploadTempRoot,
  getMediaStoragePolicy,
} from './media-upload.config';
import {
  AdminMediaAssetView,
  MediaAssetView,
  toAdminMediaAssetView,
  toMediaAssetView,
} from './media.presenter';
import { MediaKind } from './media-types';
import {
  MediaAsset,
  MediaAssetDocument,
  MediaAssetStatus,
} from './schemas/media-asset.schema';
import {
  MediaStorageUsage,
  MediaStorageUsageDocument,
} from './schemas/media-storage-usage.schema';
import {
  MEDIA_STORAGE_PROVIDER,
  MediaObjectRange,
  MediaStorageProvider,
  OpenedMediaObject,
} from './storage/media-storage.provider';

export interface PreparedPublicMedia {
  asset: MediaAssetView;
  storageKey: string;
  size: number;
  etag: string;
  lastModified?: Date;
}

export interface PaginatedMediaAssets {
  data: AdminMediaAssetView[];
  meta: { page: number; limit: number; total: number; pages: number };
}

export interface MediaStorageUsageView {
  global: MediaStorageUsageCounterView;
  currentUser: MediaStorageUsageCounterView;
  deletedRetentionDays: number;
}

interface MediaStorageUsageCounterView {
  bytes: number;
  objects: number;
  maxBytes: number;
  remainingBytes: number;
}

@Injectable()
export class MediaService {
  private readonly logger = new Logger(MediaService.name);
  private readonly tempRoot: string;
  private readonly maxImageBytes: number;
  private readonly maxVideoBytes: number;
  private readonly maxTotalStoredBytes: number;
  private readonly maxStoredBytesPerUser: number;
  private readonly deletedRetentionDays: number;

  constructor(
    @InjectModel(MediaAsset.name)
    private readonly mediaModel: Model<MediaAssetDocument>,
    @InjectModel(MediaStorageUsage.name)
    private readonly usageModel: Model<MediaStorageUsageDocument>,
    @Inject(MEDIA_STORAGE_PROVIDER)
    private readonly storage: MediaStorageProvider,
    config: ConfigService,
  ) {
    this.tempRoot = getMediaUploadTempRoot(config);
    const limits = getMediaUploadLimits(config);
    this.maxImageBytes = limits.imageBytes;
    this.maxVideoBytes = limits.videoBytes;
    const policy = getMediaStoragePolicy(config);
    this.maxTotalStoredBytes = policy.maxTotalBytes;
    this.maxStoredBytesPerUser = policy.maxBytesPerUser;
    this.deletedRetentionDays = policy.deletedRetentionDays;
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

      await this.reserveStorage(actor, stat.size);
      let reservationCommitted = false;
      try {
        const checksumSha256 = await this.hashFile(tempPath);
        const storageKey = createMediaStorageKey(file.mimetype);
        const stored = await this.storage.put({
          sourcePath: tempPath,
          key: storageKey,
          contentType: file.mimetype,
        });
        if (stored.size !== stat.size) {
          await this.storage.delete(stored.key).catch(() => undefined);
          throw new Error('Tamaño almacenado inconsistente');
        }

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
          reservationCommitted = true;
          return toMediaAssetView(asset);
        } catch (error) {
          await this.storage.delete(stored.key).catch(() => undefined);
          throw error;
        }
      } catch (error) {
        if (!reservationCommitted) await this.releaseStorage(actor, stat.size);
        throw error;
      }
    } finally {
      await this.safeUnlink(tempPath);
    }
  }

  async list(dto: ListMediaAssetsDto): Promise<PaginatedMediaAssets> {
    const page = this.boundedInteger(dto.page, 1, 1, Number.MAX_SAFE_INTEGER);
    const limit = this.boundedInteger(dto.limit, 25, 1, 100);
    const filter: FilterQuery<MediaAsset> = {};
    if (dto.status) filter.status = dto.status;
    if (dto.kind) filter.kind = dto.kind;
    if (dto.mimeType) filter.mimeType = dto.mimeType;
    if (dto.uploadedBy) filter.uploadedBy = new Types.ObjectId(dto.uploadedBy);
    if (dto.referenced === 'true') {
      filter['references.0'] = { $exists: true };
    } else if (dto.referenced === 'false') {
      filter.references = { $size: 0 };
    }
    const search = dto.search?.trim();
    if (search) {
      filter.originalName = {
        $regex: this.escapeRegularExpression(search),
        $options: 'i',
      };
    }

    const [rows, total] = await Promise.all([
      this.mediaModel
        .find(filter)
        .sort({ createdAt: -1, _id: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean()
        .exec(),
      this.mediaModel.countDocuments(filter).exec(),
    ]);
    return {
      data: rows.map((row) =>
        toAdminMediaAssetView(row as unknown as MediaAsset),
      ),
      meta: { page, limit, total, pages: Math.ceil(total / limit) },
    };
  }

  async preparePublic(id: string): Promise<PreparedPublicMedia> {
    const _id = this.toObjectId(id, 'medio');
    const asset = await this.mediaModel
      .findOne({ _id, status: MediaAssetStatus.Active })
      .lean()
      .exec();
    if (!asset || asset.storageProvider !== this.storage.providerName) {
      throw new NotFoundException('Medio no encontrado');
    }

    try {
      const metadata = await this.storage.stat(asset.storageKey);
      if (metadata.size !== asset.size)
        throw new Error('Tamaño de objeto inconsistente');
      return {
        asset: toMediaAssetView(asset as MediaAsset),
        storageKey: asset.storageKey,
        size: metadata.size,
        etag: `"sha256-${asset.checksumSha256}"`,
        lastModified: metadata.lastModified,
      };
    } catch {
      throw new NotFoundException('Medio no disponible');
    }
  }

  async openPublic(
    media: PreparedPublicMedia,
    range?: MediaObjectRange,
  ): Promise<OpenedMediaObject> {
    try {
      const object = await this.storage.open(media.storageKey, range);
      const expectedLength = range ? range.end - range.start + 1 : media.size;
      if (
        object.size !== media.size ||
        object.contentLength !== expectedLength
      ) {
        object.stream.destroy();
        throw new Error('Tamaño de objeto inconsistente');
      }
      return object;
    } catch {
      throw new NotFoundException('Medio no disponible');
    }
  }

  async getStorageUsage(actorUserId: string): Promise<MediaStorageUsageView> {
    const actor = this.toObjectId(actorUserId, 'usuario');
    const userScope = this.userUsageScope(actor);
    await Promise.all([
      this.ensureUsageCounter('global'),
      this.ensureUsageCounter(userScope, actor),
    ]);
    const counters = await this.usageModel
      .find({ scope: { $in: ['global', userScope] } })
      .lean()
      .exec();
    const byScope = new Map(counters.map((row) => [row.scope, row]));
    return {
      global: this.usageCounterView(
        byScope.get('global'),
        this.maxTotalStoredBytes,
      ),
      currentUser: this.usageCounterView(
        byScope.get(userScope),
        this.maxStoredBytesPerUser,
      ),
      deletedRetentionDays: this.deletedRetentionDays,
    };
  }

  /**
   * Purga física reintentable: primero deja el registro en `purging`, después
   * borra el objeto idempotentemente y por último elimina metadatos/uso.
   */
  async purgeDeleted(id: string, actorUserId: string) {
    const _id = this.toObjectId(id, 'medio');
    const actor = this.toObjectId(actorUserId, 'usuario');
    const now = new Date();
    const cutoff = new Date(
      now.getTime() - this.deletedRetentionDays * 24 * 60 * 60 * 1_000,
    );
    const asset = await this.mediaModel
      .findOneAndUpdate(
        {
          _id,
          storageProvider: this.storage.providerName,
          references: { $size: 0 },
          $or: [
            {
              status: MediaAssetStatus.Deleted,
              deletedAt: { $lte: cutoff },
            },
            { status: MediaAssetStatus.Purging },
          ],
        },
        {
          $set: {
            status: MediaAssetStatus.Purging,
            purgeRequestedAt: now,
            purgeRequestedBy: actor,
          },
        },
        { new: true },
      )
      .exec();

    if (!asset) {
      const existing = await this.mediaModel
        .findById(_id)
        .select('status storageProvider references deletedAt')
        .lean()
        .exec();
      if (!existing) throw new NotFoundException('Medio no encontrado');
      if (existing.storageProvider !== this.storage.providerName) {
        throw new ConflictException(
          'El proveedor configurado no puede purgar este medio',
        );
      }
      if (existing.status === MediaAssetStatus.Active) {
        throw new ConflictException(
          'El medio debe eliminarse lógicamente antes de purgarlo',
        );
      }
      if (existing.references?.length) {
        throw new ConflictException('El medio todavía está referenciado');
      }
      const eligibleAt = existing.deletedAt
        ? new Date(
            existing.deletedAt.getTime() +
              this.deletedRetentionDays * 24 * 60 * 60 * 1_000,
          )
        : undefined;
      throw new ConflictException({
        message: 'El periodo de retención del medio todavía no terminó',
        code: 'MEDIA_RETENTION_ACTIVE',
        meta: { eligibleAt },
      });
    }
    try {
      await this.storage.delete(asset.storageKey);
    } catch (error) {
      const errorName =
        error instanceof Error && error.name ? error.name : 'UnknownError';
      this.logger.error(
        `No se pudo purgar el objeto ${asset.id} (${errorName.replace(/[^A-Za-z0-9_.:-]/g, '').slice(0, 80) || 'UnknownError'})`,
      );
      throw new ServiceUnavailableException(
        'No fue posible purgar el medio; la operación puede reintentarse',
      );
    }

    const removed = await this.mediaModel
      .findOneAndDelete({
        _id,
        status: MediaAssetStatus.Purging,
        references: { $size: 0 },
      })
      .lean()
      .exec();
    if (!removed) {
      throw new ConflictException('El medio cambió durante la purga');
    }
    await this.releaseStorage(removed.uploadedBy, removed.size);
    return { id, purged: true, purgedAt: new Date() };
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

  private boundedInteger(
    value: number | undefined,
    fallback: number,
    minimum: number,
    maximum: number,
  ): number {
    const parsed = Number(value ?? fallback);
    if (!Number.isInteger(parsed)) return fallback;
    return Math.min(maximum, Math.max(minimum, parsed));
  }

  private escapeRegularExpression(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  private async reserveStorage(
    actor: Types.ObjectId,
    bytes: number,
  ): Promise<void> {
    const userScope = this.userUsageScope(actor);
    await Promise.all([
      this.ensureUsageCounter('global'),
      this.ensureUsageCounter(userScope, actor),
    ]);
    await this.reserveUsageCounter('global', bytes, this.maxTotalStoredBytes);
    try {
      await this.reserveUsageCounter(
        userScope,
        bytes,
        this.maxStoredBytesPerUser,
      );
    } catch (error) {
      await this.releaseUsageCounter('global', bytes).catch(() => {
        this.logger.error(
          'No se pudo revertir la reserva global de almacenamiento de medios',
        );
      });
      throw error;
    }
  }

  private async ensureUsageCounter(
    scope: string,
    uploadedBy?: Types.ObjectId,
  ): Promise<void> {
    const exists = await this.usageModel.exists({ scope }).exec();
    if (exists) return;
    const match = uploadedBy ? { uploadedBy } : {};
    const [calculated] = await this.mediaModel
      .aggregate<{ bytes: number; objects: number }>([
        { $match: match },
        {
          $group: {
            _id: null,
            bytes: { $sum: '$size' },
            objects: { $sum: 1 },
          },
        },
      ])
      .exec();
    try {
      await this.usageModel.create({
        scope,
        bytes: calculated?.bytes ?? 0,
        objects: calculated?.objects ?? 0,
      });
    } catch (error) {
      if (!this.isDuplicateKey(error)) throw error;
    }
  }

  private async reserveUsageCounter(
    scope: string,
    bytes: number,
    maximum: number,
  ): Promise<void> {
    const remainingBeforeReservation = maximum - bytes;
    const reserved =
      remainingBeforeReservation >= 0
        ? await this.usageModel
            .findOneAndUpdate(
              { scope, bytes: { $lte: remainingBeforeReservation } },
              { $inc: { bytes, objects: 1 } },
              { new: true },
            )
            .lean()
            .exec()
        : null;
    if (reserved) return;
    throw new HttpException(
      {
        statusCode: 507,
        message: 'No hay cuota de almacenamiento disponible para este medio',
        code: 'MEDIA_STORAGE_QUOTA_EXCEEDED',
        meta: { scope, maxBytes: maximum },
      },
      507,
    );
  }

  private async releaseStorage(
    actor: Types.ObjectId,
    bytes: number,
  ): Promise<void> {
    const results = await Promise.allSettled([
      this.releaseUsageCounter('global', bytes),
      this.releaseUsageCounter(this.userUsageScope(actor), bytes),
    ]);
    if (results.some((result) => result.status === 'rejected')) {
      this.logger.error(
        'No se pudo liberar completamente la cuota de almacenamiento de medios',
      );
    }
  }

  private async releaseUsageCounter(
    scope: string,
    bytes: number,
  ): Promise<void> {
    await this.usageModel
      .updateOne(
        { scope, bytes: { $gte: bytes }, objects: { $gte: 1 } },
        { $inc: { bytes: -bytes, objects: -1 } },
      )
      .exec();
  }

  private userUsageScope(actor: Types.ObjectId): string {
    return `user:${actor.toString()}`;
  }

  private usageCounterView(
    counter: { bytes?: number; objects?: number } | undefined,
    maxBytes: number,
  ): MediaStorageUsageCounterView {
    const bytes = Math.max(0, Number(counter?.bytes ?? 0));
    return {
      bytes,
      objects: Math.max(0, Number(counter?.objects ?? 0)),
      maxBytes,
      remainingBytes: Math.max(0, maxBytes - bytes),
    };
  }

  private isDuplicateKey(error: unknown): boolean {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      (error as { code?: number }).code === 11000
    );
  }
}
