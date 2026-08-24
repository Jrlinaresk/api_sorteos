import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Readable } from 'node:stream';
import { Types } from 'mongoose';
import { MediaService } from './media.service';
import { MediaKind } from './media-types';
import { MediaAssetStatus } from './schemas/media-asset.schema';

describe('MediaService security', () => {
  const actorId = new Types.ObjectId().toString();

  function serviceWith(
    mediaModel: object,
    storage: object,
    usageModel: object = {},
  ) {
    return new MediaService(
      mediaModel as never,
      usageModel as never,
      storage as never,
      new ConfigService({ MEDIA_UPLOAD_TMP_DIR: '/safe/media-temp' }),
    );
  }

  it('rejects a forged upload path outside the configured temp root', async () => {
    const storage = { put: jest.fn() };
    const service = serviceWith({}, storage);

    await expect(
      service.createFromUpload(
        {
          path: '/safe/media-temp-evil/attack.upload',
          mimetype: 'image/png',
        } as Express.Multer.File,
        actorId,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(storage.put).not.toHaveBeenCalled();
  });

  it('uses an atomic empty-reference filter for soft deletion', async () => {
    const mediaId = new Types.ObjectId();
    const findOneAndUpdate = jest.fn().mockReturnValue({
      exec: jest.fn().mockResolvedValue({ id: mediaId.toString() }),
    });
    const service = serviceWith({ findOneAndUpdate }, { providerName: 'test' });

    await service.softDelete(mediaId.toString(), actorId);

    expect(findOneAndUpdate.mock.calls[0][0]).toEqual({
      _id: expect.any(Types.ObjectId),
      status: MediaAssetStatus.Active,
      references: { $size: 0 },
    });
  });

  it('refuses deletion when the asset is referenced', async () => {
    const mediaId = new Types.ObjectId();
    const mediaModel = {
      findOneAndUpdate: jest.fn().mockReturnValue({
        exec: jest.fn().mockResolvedValue(null),
      }),
      findById: jest.fn().mockReturnValue({
        select: jest.fn().mockReturnValue({
          lean: jest.fn().mockReturnValue({
            exec: jest.fn().mockResolvedValue({
              status: MediaAssetStatus.Active,
              references: ['campaign:active-campaign'],
            }),
          }),
        }),
      }),
    };
    const service = serviceWith(mediaModel, { providerName: 'test' });

    await expect(
      service.softDelete(mediaId.toString(), actorId),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('lists a bounded admin library with literal search and useful filters', async () => {
    const mediaId = new Types.ObjectId();
    const uploaderId = new Types.ObjectId();
    const now = new Date('2026-08-24T12:00:00Z');
    const row = {
      _id: mediaId,
      storageProvider: 'test',
      storageKey: 'opaque.png',
      originalName: 'photo.*.png',
      mimeType: 'image/png',
      kind: MediaKind.Image,
      extension: 'png',
      size: 4,
      checksumSha256: 'a'.repeat(64),
      uploadedBy: uploaderId,
      references: ['campaign:one'],
      status: MediaAssetStatus.Active,
      createdAt: now,
      updatedAt: now,
    };
    const findQuery = {
      sort: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      lean: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue([row]),
    };
    const countQuery = { exec: jest.fn().mockResolvedValue(101) };
    const mediaModel = {
      find: jest.fn().mockReturnValue(findQuery),
      countDocuments: jest.fn().mockReturnValue(countQuery),
    };
    const service = serviceWith(mediaModel, { providerName: 'test' });

    const result = await service.list({
      page: 2,
      limit: 999,
      status: MediaAssetStatus.Active,
      kind: MediaKind.Image,
      uploadedBy: uploaderId.toString(),
      referenced: 'true',
      search: ' photo.* ',
    });

    expect(mediaModel.find).toHaveBeenCalledWith({
      status: MediaAssetStatus.Active,
      kind: MediaKind.Image,
      uploadedBy: expect.any(Types.ObjectId),
      'references.0': { $exists: true },
      originalName: { $regex: 'photo\\.\\*', $options: 'i' },
    });
    expect(findQuery.skip).toHaveBeenCalledWith(100);
    expect(findQuery.limit).toHaveBeenCalledWith(100);
    expect(result.meta).toEqual({ page: 2, limit: 100, total: 101, pages: 2 });
    expect(result.data[0]).toMatchObject({
      id: mediaId.toString(),
      uploadedBy: uploaderId.toString(),
      references: ['campaign:one'],
      publicUrl: `/api/v1/media/${mediaId.toString()}`,
    });
  });

  it('prepares metadata before opening and streams only the requested range', async () => {
    const mediaId = new Types.ObjectId();
    const now = new Date('2026-08-24T12:00:00Z');
    const row = {
      _id: mediaId,
      storageProvider: 'test',
      storageKey: 'opaque/video.mp4',
      originalName: 'video.mp4',
      mimeType: 'video/mp4',
      kind: MediaKind.Video,
      extension: 'mp4',
      size: 10,
      checksumSha256: 'b'.repeat(64),
      uploadedBy: new Types.ObjectId(),
      references: [],
      status: MediaAssetStatus.Active,
      createdAt: now,
      updatedAt: now,
    };
    const mediaModel = {
      findOne: jest.fn().mockReturnValue({
        lean: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue(row),
        }),
      }),
    };
    const opened = {
      stream: Readable.from(Buffer.from('2345')),
      size: 10,
      contentLength: 4,
      lastModified: now,
    };
    const storage = {
      providerName: 'test',
      stat: jest.fn().mockResolvedValue({ size: 10, lastModified: now }),
      open: jest.fn().mockResolvedValue(opened),
    };
    const service = serviceWith(mediaModel, storage);

    const prepared = await service.preparePublic(mediaId.toString());
    const result = await service.openPublic(prepared, { start: 2, end: 5 });

    expect(storage.stat).toHaveBeenCalledWith('opaque/video.mp4');
    expect(storage.open).toHaveBeenCalledWith('opaque/video.mp4', {
      start: 2,
      end: 5,
    });
    expect(prepared).toMatchObject({
      storageKey: 'opaque/video.mp4',
      size: 10,
      etag: `"sha256-${'b'.repeat(64)}"`,
      lastModified: now,
    });
    expect(result).toBe(opened);
  });

  it('does not expose an asset whose stored size changed', async () => {
    const mediaId = new Types.ObjectId();
    const mediaModel = {
      findOne: jest.fn().mockReturnValue({
        lean: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue({
            _id: mediaId,
            storageProvider: 'test',
            storageKey: 'opaque.png',
            size: 10,
          }),
        }),
      }),
    };
    const service = serviceWith(mediaModel, {
      providerName: 'test',
      stat: jest.fn().mockResolvedValue({ size: 9 }),
    });

    await expect(
      service.preparePublic(mediaId.toString()),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
