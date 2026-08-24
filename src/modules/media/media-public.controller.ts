import {
  Controller,
  Get,
  Head,
  Headers,
  HttpException,
  HttpStatus,
  Param,
  Res,
  StreamableFile,
} from '@nestjs/common';
import {
  ApiHeader,
  ApiOkResponse,
  ApiOperation,
  ApiProduces,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Response } from 'express';
import {
  ifNoneMatchMatches,
  InvalidMediaRangeError,
  parseSingleByteRange,
} from './media-http';
import { MediaService, PreparedPublicMedia } from './media.service';

@ApiTags('Media')
@Controller('media')
export class MediaPublicController {
  constructor(private readonly mediaService: MediaService) {}

  @Head(':mediaId')
  @ApiOperation({ summary: 'Consultar metadatos HTTP de un medio activo' })
  @ApiHeader({ name: 'If-None-Match', required: false })
  @ApiOkResponse({ description: 'Metadatos del medio sin cuerpo' })
  @ApiResponse({
    status: 304,
    description: 'La versión cacheada sigue vigente',
  })
  async head(
    @Param('mediaId') mediaId: string,
    @Headers('if-none-match') ifNoneMatch: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    const media = await this.mediaService.preparePublic(mediaId);
    this.setRepresentationHeaders(response, media);
    if (ifNoneMatchMatches(ifNoneMatch, media.etag)) {
      response.status(HttpStatus.NOT_MODIFIED);
      return;
    }
    response.setHeader('Content-Length', String(media.size));
  }

  @Get(':mediaId')
  @ApiOperation({ summary: 'Obtener un medio activo por ID' })
  @ApiProduces(
    'image/jpeg',
    'image/png',
    'image/webp',
    'video/mp4',
    'video/webm',
  )
  @ApiHeader({
    name: 'Range',
    required: false,
    example: 'bytes=0-1048575',
    description: 'Se admite un único rango de bytes',
  })
  @ApiHeader({ name: 'If-None-Match', required: false })
  @ApiOkResponse({ description: 'Stream completo del medio' })
  @ApiResponse({ status: 206, description: 'Stream del rango solicitado' })
  @ApiResponse({
    status: 304,
    description: 'La versión cacheada sigue vigente',
  })
  @ApiResponse({ status: 416, description: 'Rango inválido o no satisfacible' })
  async get(
    @Param('mediaId') mediaId: string,
    @Headers('range') rangeHeader: string | undefined,
    @Headers('if-none-match') ifNoneMatch: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ): Promise<StreamableFile | undefined> {
    const media = await this.mediaService.preparePublic(mediaId);
    this.setRepresentationHeaders(response, media);

    if (ifNoneMatchMatches(ifNoneMatch, media.etag)) {
      response.status(HttpStatus.NOT_MODIFIED);
      return undefined;
    }

    let range;
    try {
      range = parseSingleByteRange(rangeHeader, media.size);
    } catch (error) {
      if (!(error instanceof InvalidMediaRangeError)) throw error;
      response.setHeader('Content-Range', `bytes */${media.size}`);
      throw new HttpException(
        {
          statusCode: HttpStatus.REQUESTED_RANGE_NOT_SATISFIABLE,
          message: 'Rango de bytes no satisfacible',
          code: 'MEDIA_RANGE_NOT_SATISFIABLE',
        },
        HttpStatus.REQUESTED_RANGE_NOT_SATISFIABLE,
      );
    }

    const object = await this.mediaService.openPublic(media, range);
    if (range) {
      response.status(HttpStatus.PARTIAL_CONTENT);
      response.setHeader(
        'Content-Range',
        `bytes ${range.start}-${range.end}/${media.size}`,
      );
      response.setHeader('Content-Length', String(range.length));
    } else {
      response.setHeader('Content-Length', String(media.size));
    }
    return new StreamableFile(object.stream);
  }

  private setRepresentationHeaders(
    response: Response,
    media: PreparedPublicMedia,
  ): void {
    response.setHeader('Content-Type', media.asset.mimeType);
    response.setHeader('Accept-Ranges', 'bytes');
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
    if (media.lastModified) {
      response.setHeader('Last-Modified', media.lastModified.toUTCString());
    }
  }
}
