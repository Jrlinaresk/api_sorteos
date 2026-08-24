import { HttpStatus, StreamableFile } from '@nestjs/common';
import { Readable } from 'node:stream';
import { MediaPublicController } from './media-public.controller';
import { MediaService, PreparedPublicMedia } from './media.service';
import { MediaKind } from './media-types';
import { MediaAssetStatus } from './schemas/media-asset.schema';

describe('MediaPublicController', () => {
  const now = new Date('2026-08-24T12:00:00Z');
  const prepared: PreparedPublicMedia = {
    asset: {
      id: 'media-id',
      originalName: 'photo.png',
      mimeType: 'image/png',
      kind: MediaKind.Image,
      extension: 'png',
      size: 10,
      checksumSha256: 'a'.repeat(64),
      status: MediaAssetStatus.Active,
      referenceCount: 0,
      publicUrl: '/api/v1/media/media-id',
      createdAt: now,
      updatedAt: now,
    },
    storageKey: 'opaque/media.png',
    size: 10,
    lastModified: now,
    etag: '"sha256-checksum"',
  };

  function setup() {
    const service = {
      preparePublic: jest.fn().mockResolvedValue(prepared),
      openPublic: jest.fn().mockResolvedValue({
        stream: Readable.from(Buffer.from('0123456789')),
        size: 10,
        contentLength: 10,
        lastModified: now,
      }),
    } as unknown as MediaService;
    const response = {
      setHeader: jest.fn(),
      status: jest.fn().mockReturnThis(),
    };
    return {
      controller: new MediaPublicController(service),
      service,
      response,
    };
  }

  it('serves the complete stream with cache, length and anti-sniffing headers', async () => {
    const { controller, service, response } = setup();

    const result = await controller.get(
      'media-id',
      undefined,
      undefined,
      response as never,
    );

    expect(result).toBeInstanceOf(StreamableFile);
    expect(service.preparePublic).toHaveBeenCalledWith('media-id');
    expect(service.openPublic).toHaveBeenCalledWith(prepared, undefined);
    expect(response.setHeader).toHaveBeenCalledWith(
      'Content-Type',
      'image/png',
    );
    expect(response.setHeader).toHaveBeenCalledWith('Accept-Ranges', 'bytes');
    expect(response.setHeader).toHaveBeenCalledWith('Content-Length', '10');
    expect(response.setHeader).toHaveBeenCalledWith(
      'X-Content-Type-Options',
      'nosniff',
    );
    expect(response.setHeader).toHaveBeenCalledWith(
      'Cache-Control',
      'public, max-age=3600, stale-while-revalidate=86400',
    );
    expect(response.setHeader).toHaveBeenCalledWith(
      'Content-Disposition',
      'inline; filename="media-id.png"',
    );
  });

  it('serves one satisfiable byte range as 206', async () => {
    const { controller, service, response } = setup();
    (service.openPublic as jest.Mock).mockResolvedValueOnce({
      stream: Readable.from(Buffer.from('2345')),
      size: 10,
      contentLength: 4,
      lastModified: now,
    });

    const result = await controller.get(
      'media-id',
      'bytes=2-5',
      undefined,
      response as never,
    );

    expect(result).toBeInstanceOf(StreamableFile);
    expect(service.openPublic).toHaveBeenCalledWith(prepared, {
      start: 2,
      end: 5,
      length: 4,
    });
    expect(response.status).toHaveBeenCalledWith(HttpStatus.PARTIAL_CONTENT);
    expect(response.setHeader).toHaveBeenCalledWith(
      'Content-Range',
      'bytes 2-5/10',
    );
    expect(response.setHeader).toHaveBeenCalledWith('Content-Length', '4');
  });

  it('answers 304 without opening a stream when If-None-Match matches', async () => {
    const { controller, service, response } = setup();

    const result = await controller.get(
      'media-id',
      'bytes=0-1',
      'W/"sha256-checksum"',
      response as never,
    );

    expect(result).toBeUndefined();
    expect(response.status).toHaveBeenCalledWith(HttpStatus.NOT_MODIFIED);
    expect(service.openPublic).not.toHaveBeenCalled();
  });

  it('answers 416 with the total length and never opens invalid ranges', async () => {
    const { controller, service, response } = setup();

    await expect(
      controller.get('media-id', 'bytes=10-20', undefined, response as never),
    ).rejects.toMatchObject({
      status: HttpStatus.REQUESTED_RANGE_NOT_SATISFIABLE,
    });
    expect(response.setHeader).toHaveBeenCalledWith(
      'Content-Range',
      'bytes */10',
    );
    expect(service.openPublic).not.toHaveBeenCalled();
  });

  it('implements HEAD and conditional HEAD without creating a stream', async () => {
    const { controller, service, response } = setup();

    await controller.head('media-id', undefined, response as never);
    expect(response.setHeader).toHaveBeenCalledWith('Content-Length', '10');
    expect(service.openPublic).not.toHaveBeenCalled();

    await controller.head('media-id', '"sha256-checksum"', response as never);
    expect(response.status).toHaveBeenCalledWith(HttpStatus.NOT_MODIFIED);
    expect(service.openPublic).not.toHaveBeenCalled();
  });
});
