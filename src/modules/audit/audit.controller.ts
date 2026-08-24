import {
  Controller,
  Get,
  Param,
  Query,
  Res,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiProduces,
  ApiTags,
} from '@nestjs/swagger';
import { Response } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserRole } from '../users/enums/user-role.enum';
import { AuditAction } from './decorators/audit-action.decorator';
import { AuditService, PaginatedAuditLogs } from './audit.service';
import { ListAuditLogsDto } from './dto/list-audit-logs.dto';
import { AuditCategory } from './enums/audit-category.enum';

@ApiTags('Admin - Audit')
@ApiBearerAuth()
@Controller('admin/audit-logs')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN, UserRole.OPERATOR)
export class AuditController {
  constructor(private readonly auditService: AuditService) {}

  @Get()
  @ApiOperation({ summary: 'Consulta paginada del registro de auditoría' })
  @ApiOkResponse({ description: 'Eventos append-only ordenados por fecha' })
  @AuditAction({
    action: 'audit.logs.list',
    category: AuditCategory.DATA_ACCESS,
    resourceType: 'audit_log',
    captureResponse: false,
  })
  list(@Query() dto: ListAuditLogsDto): Promise<PaginatedAuditLogs> {
    return this.auditService.list(dto);
  }

  @Get('export.csv')
  @ApiOperation({ summary: 'Exporta la auditoría filtrada en CSV' })
  @ApiProduces('text/csv')
  @AuditAction({
    action: 'audit.logs.export',
    category: AuditCategory.DATA_ACCESS,
    resourceType: 'audit_log',
    captureResponse: false,
  })
  async exportCsv(
    @Query() dto: ListAuditLogsDto,
    @Res({ passthrough: true }) response: Response,
  ): Promise<StreamableFile> {
    const csv = await this.auditService.exportCsv(dto);
    response.setHeader('Content-Type', 'text/csv; charset=utf-8');
    response.setHeader(
      'Content-Disposition',
      `attachment; filename="audit-${new Date().toISOString().slice(0, 10)}.csv"`,
    );
    return new StreamableFile(Buffer.from(csv, 'utf8'));
  }

  @Get(':id')
  @ApiOperation({ summary: 'Obtiene un evento de auditoría' })
  @ApiOkResponse({ description: 'Evento de auditoría' })
  @AuditAction({
    action: 'audit.logs.read',
    category: AuditCategory.DATA_ACCESS,
    resourceType: 'audit_log',
    resourceIdParam: 'id',
    captureResponse: false,
  })
  findOne(@Param('id') id: string): Promise<Record<string, unknown>> {
    return this.auditService.findOne(id);
  }
}
