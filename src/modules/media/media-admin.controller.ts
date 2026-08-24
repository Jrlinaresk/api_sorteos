import {
  BadRequestException,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiOkResponse,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { PublicUserDto } from '../users/dto/public-user.dto';
import { UserRole } from '../users/enums/user-role.enum';
import { ListMediaAssetsDto } from './dto/list-media-assets.dto';
import { MediaService, PaginatedMediaAssets } from './media.service';

@ApiTags('Admin Media')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.OPERATOR, UserRole.ADMIN)
@Controller('admin/media')
export class MediaAdminController {
  constructor(private readonly mediaService: MediaService) {}

  @Get()
  @ApiOperation({ summary: 'Consultar la biblioteca de medios paginada' })
  @ApiOkResponse({
    description:
      'Medios ordenados por fecha, con referencias y metadatos administrativos',
  })
  list(@Query() query: ListMediaAssetsDto): Promise<PaginatedMediaAssets> {
    return this.mediaService.list(query);
  }

  @Get('storage-usage')
  @ApiOperation({ summary: 'Consultar cuotas y uso del almacenamiento' })
  @ApiOkResponse({ description: 'Uso global y del operador autenticado' })
  storageUsage(@CurrentUser() user: PublicUserDto) {
    return this.mediaService.getStorageUsage(user.id);
  }

  @Post()
  @Throttle({
    default: {
      limit: 20,
      ttl: 60 * 60 * 1_000,
      blockDuration: 60 * 60 * 1_000,
    },
  })
  @UseInterceptors(FileInterceptor('file'))
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file'],
      properties: { file: { type: 'string', format: 'binary' } },
    },
  })
  @ApiOperation({ summary: 'Subir una imagen o video seguro' })
  @ApiResponse({ status: 413, description: 'Archivo mayor al límite por tipo' })
  @ApiResponse({ status: 429, description: 'Frecuencia de uploads excedida' })
  @ApiResponse({ status: 507, description: 'Cuota de almacenamiento agotada' })
  upload(
    @UploadedFile() file: Express.Multer.File | undefined,
    @CurrentUser() user: PublicUserDto,
  ) {
    if (!file) throw new BadRequestException('Archivo obligatorio');
    return this.mediaService.createFromUpload(file, user.id);
  }

  @Delete(':mediaId/purge')
  @Roles(UserRole.ADMIN)
  @ApiOperation({
    summary: 'Purgar físicamente un medio tras el periodo de retención',
  })
  @ApiResponse({
    status: 409,
    description: 'Medio activo, referenciado o todavía retenido',
  })
  @ApiResponse({
    status: 503,
    description: 'El proveedor no pudo borrar el objeto',
  })
  purge(@Param('mediaId') mediaId: string, @CurrentUser() user: PublicUserDto) {
    return this.mediaService.purgeDeleted(mediaId, user.id);
  }

  @Delete(':mediaId')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Eliminar lógicamente un medio sin referencias' })
  remove(
    @Param('mediaId') mediaId: string,
    @CurrentUser() user: PublicUserDto,
  ) {
    return this.mediaService.softDelete(mediaId, user.id);
  }
}
