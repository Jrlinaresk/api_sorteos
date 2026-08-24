import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { AuditAction } from '../audit/decorators/audit-action.decorator';
import { AuditCategory } from '../audit/enums/audit-category.enum';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { UserRole } from '../users/enums/user-role.enum';
import { PublicUserDto } from '../users/dto/public-user.dto';
import { ChangeCampaignStatusDto } from './dto/change-campaign-status.dto';
import { CreateRaffleDto } from './dto/create-raffle.dto';
import { ExtendCampaignDto } from './dto/extend-campaign.dto';
import { UpdateRaffleDto } from './enums/update-raffle.dto';
import { RafflesService } from './raffles.service';

type AuthenticatedRequest = Request & { user: PublicUserDto };

@ApiTags('Admin campaigns')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.OPERATOR, UserRole.ADMIN)
@Controller('admin/campaigns')
export class RafflesController {
  constructor(private readonly campaigns: RafflesService) {}

  @Post()
  @ApiOperation({ summary: 'Crea una campaña en borrador o programada' })
  create(@Body() dto: CreateRaffleDto) {
    return this.campaigns.create(dto);
  }

  @Get()
  @ApiOperation({
    summary: 'Lista todas las campañas, incluidos borradores y canceladas',
  })
  list() {
    return this.campaigns.findAll();
  }

  @Get(':id')
  find(@Param('id') id: string) {
    return this.campaigns.findOne(id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateRaffleDto) {
    return this.campaigns.update(id, dto);
  }

  @Patch(':id/status')
  changeStatus(@Param('id') id: string, @Body() dto: ChangeCampaignStatusDto) {
    return this.campaigns.changeStatus(id, dto.status);
  }

  @Post(':id/extension')
  @Roles(UserRole.ADMIN)
  @AuditAction({
    action: 'campaign.lifecycle.extend',
    category: AuditCategory.ADMINISTRATION,
    resourceType: 'campaign',
    resourceIdParam: 'id',
    captureRequest: true,
  })
  @ApiOperation({
    summary: 'Prorroga y reabre una campaña vencida con trazabilidad del actor',
  })
  extendExpired(
    @Param('id') id: string,
    @Body() dto: ExtendCampaignDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.campaigns.extendExpiredCampaign(id, dto, request.user.id);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.campaigns.remove(id);
  }
}
