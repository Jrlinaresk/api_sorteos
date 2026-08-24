import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { UserRole } from '../users/enums/user-role.enum';
import { ChangeCampaignStatusDto } from './dto/change-campaign-status.dto';
import { CreateRaffleDto } from './dto/create-raffle.dto';
import { UpdateRaffleDto } from './enums/update-raffle.dto';
import { RafflesService } from './raffles.service';

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
  @ApiOperation({ summary: 'Lista todas las campañas, incluidos borradores y canceladas' })
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

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.campaigns.remove(id);
  }
}
