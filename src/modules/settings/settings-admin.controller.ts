import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { Request } from 'express';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { AuditActorContext } from '../audit/interfaces/audit-event.interface';
import { PublicUserDto } from '../users/dto/public-user.dto';
import { UserRole } from '../users/enums/user-role.enum';
import { CreateSettingsVersionDto } from './dto/create-settings-version.dto';
import { ListSettingsVersionsDto } from './dto/list-settings-versions.dto';
import { UpdateSettingsVersionDto } from './dto/update-settings-version.dto';
import { PaginatedSettingsVersions, SettingsService } from './settings.service';

type AuthenticatedRequest = Request & { user: PublicUserDto };

@ApiTags('Admin - Settings')
@ApiBearerAuth()
@Controller('admin/settings')
@UseGuards(JwtAuthGuard, RolesGuard)
export class SettingsAdminController {
  constructor(private readonly settingsService: SettingsService) {}

  @Get()
  @Roles(UserRole.ADMIN, UserRole.OPERATOR)
  @ApiOperation({ summary: 'Lista las versiones de configuración' })
  list(
    @Query() dto: ListSettingsVersionsDto,
  ): Promise<PaginatedSettingsVersions> {
    return this.settingsService.list(dto);
  }

  @Get(':version')
  @Roles(UserRole.ADMIN, UserRole.OPERATOR)
  @ApiOperation({ summary: 'Obtiene una versión de configuración' })
  getVersion(
    @Param('version', ParseIntPipe) version: number,
  ): Promise<Record<string, unknown>> {
    return this.settingsService.getVersion(version);
  }

  @Post()
  @Roles(UserRole.ADMIN)
  @ApiCreatedResponse({ description: 'Nueva versión borrador' })
  create(
    @Body() dto: CreateSettingsVersionDto,
    @Req() request: AuthenticatedRequest,
  ): Promise<Record<string, unknown>> {
    return this.settingsService.createVersion(dto, this.auditContext(request));
  }

  @Patch(':version')
  @Roles(UserRole.ADMIN)
  @ApiOkResponse({ description: 'Borrador actualizado' })
  update(
    @Param('version', ParseIntPipe) version: number,
    @Body() dto: UpdateSettingsVersionDto,
    @Req() request: AuthenticatedRequest,
  ): Promise<Record<string, unknown>> {
    return this.settingsService.updateDraft(
      version,
      dto,
      this.auditContext(request),
    );
  }

  @Post(':version/publish')
  @Roles(UserRole.ADMIN)
  @ApiOkResponse({ description: 'Versión publicada' })
  publish(
    @Param('version', ParseIntPipe) version: number,
    @Req() request: AuthenticatedRequest,
  ): Promise<Record<string, unknown>> {
    return this.settingsService.publish(version, this.auditContext(request));
  }

  @Delete(':version')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Archiva una versión no vigente' })
  @ApiOkResponse({ description: 'Versión archivada; el historial se conserva' })
  archive(
    @Param('version', ParseIntPipe) version: number,
    @Req() request: AuthenticatedRequest,
  ): Promise<Record<string, unknown>> {
    return this.settingsService.archive(version, this.auditContext(request));
  }

  private auditContext(request: AuthenticatedRequest): AuditActorContext {
    return {
      actorId: request.user.id,
      actorRole: request.user.role,
      ip: request.ip,
      userAgent: request.get('user-agent'),
      correlationId: request.get('x-correlation-id'),
    };
  }
}
