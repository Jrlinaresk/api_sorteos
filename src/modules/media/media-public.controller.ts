import { Controller, Get, Param, Res, StreamableFile } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import { MediaService } from './media.service';

@ApiTags('Media')
@Controller('media')
export class MediaPublicController {
  constructor(private readonly mediaService: MediaService) {}

  @Get(':mediaId')
  @ApiOperation({ summary: 'Obtener un medio activo por ID' })
  async get(
    @Param('mediaId') mediaId: string,
    @Res({ passthrough: true }) response: Response,
  ): Promise<StreamableFile> {
    const media = await this.mediaService.openPublic(mediaId);
    response.setHeader('Content-Type', media.asset.mimeType);
    response.setHeader('Content-Length', String(media.object.size));
    response.setHeader('ETag', media.etag);
    response.setHeader(
      'Cache-Control',
      'public, max-age=3600, stale-while-revalidate=86400',
    );
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    response.setHeader(
      'Content-Disposition',
      `inline; filename="${media.asset.id}.${media.asset.extension}"`,
    );
    if (media.object.lastModified) {
      response.setHeader(
        'Last-Modified',
        media.object.lastModified.toUTCString(),
      );
    }
    return new StreamableFile(media.object.stream);
  }
}
