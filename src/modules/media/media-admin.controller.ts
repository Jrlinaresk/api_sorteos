import {
  BadRequestException,
  Controller,
  Delete,
  Param,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { PublicUserDto } from '../users/dto/public-user.dto';
import { UserRole } from '../users/enums/user-role.enum';
import { MediaService } from './media.service';

@ApiTags('Admin Media')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.OPERATOR, UserRole.ADMIN)
@Controller('admin/media')
export class MediaAdminController {
  constructor(private readonly mediaService: MediaService) {}

  @Post()
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
  upload(
    @UploadedFile() file: Express.Multer.File | undefined,
    @CurrentUser() user: PublicUserDto,
  ) {
    if (!file) throw new BadRequestException('Archivo obligatorio');
    return this.mediaService.createFromUpload(file, user.id);
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
