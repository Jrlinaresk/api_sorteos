import { BadRequestException, ConflictException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Types } from 'mongoose';
import { MediaService } from './media.service';
import { MediaAssetStatus } from './schemas/media-asset.schema';

describe('MediaService security', () => {
  const actorId = new Types.ObjectId().toString();

  function serviceWith(mediaModel: object, storage: object) {
    return new MediaService(
      mediaModel as never,
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
});
