import { StreamableFile } from '@nestjs/common';
import { Readable } from 'node:stream';
import { MediaPublicController } from './media-public.controller';
import { MediaService } from './media.service';
import { MediaKind } from './media-types';
import { MediaAssetStatus } from './schemas/media-asset.schema';

describe('MediaPublicController', () => {
  it('serves the stored MIME with cache and anti-sniffing headers', async () => {
    const now = new Date('2026-08-24T12:00:00Z');
    const service = {
      openPublic: jest.fn().mockResolvedValue({
        asset: {
          id: 'media-id',
          originalName: 'photo.png',
          mimeType: 'image/png',
          kind: MediaKind.Image,
          extension: 'png',
          size: 4,
          checksumSha256: 'a'.repeat(64),
          status: MediaAssetStatus.Active,
          referenceCount: 0,
          publicUrl: '/media/media-id',
          createdAt: now,
          updatedAt: now,
        },
        object: {
          stream: Readable.from(Buffer.from('data')),
          size: 4,
          lastModified: now,
        },
        etag: '"sha256-checksum"',
      }),
    } as unknown as MediaService;
    const setHeader = jest.fn();
    const controller = new MediaPublicController(service);

    const result = await controller.get('media-id', { setHeader } as never);

    expect(result).toBeInstanceOf(StreamableFile);
    expect(service.openPublic).toHaveBeenCalledWith('media-id');
    expect(setHeader).toHaveBeenCalledWith('Content-Type', 'image/png');
    expect(setHeader).toHaveBeenCalledWith('Content-Length', '4');
    expect(setHeader).toHaveBeenCalledWith('X-Content-Type-Options', 'nosniff');
    expect(setHeader).toHaveBeenCalledWith(
      'Cache-Control',
      'public, max-age=3600, stale-while-revalidate=86400',
    );
    expect(setHeader).toHaveBeenCalledWith(
      'Content-Disposition',
      'inline; filename="media-id.png"',
    );
  });
});
