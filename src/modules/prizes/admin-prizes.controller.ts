import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserRole } from '../users/enums/user-role.enum';
import { CreateInstantPrizeDto } from './dto/create-instant-prize.dto';
import { UpdateInstantPrizeDto } from './dto/update-instant-prize.dto';
import { PrizesService } from './prizes.service';
import {
  ListAdminPrizeAwardsDto,
  ListAdminPrizesDto,
} from './dto/list-admin-prizes.dto';

@ApiTags('Admin prizes')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.OPERATOR, UserRole.ADMIN)
@Controller('admin/prizes')
export class AdminPrizesController {
  constructor(private readonly prizes: PrizesService) {}

  @Post()
  create(@Body() dto: CreateInstantPrizeDto) {
    return this.prizes.create(dto);
  }

  @Get()
  @ApiOperation({ summary: 'Listar el inventario de premios con filtros' })
  list(@Query() query: ListAdminPrizesDto) {
    return this.prizes.listAdminPrizes(query);
  }

  @Get('awards')
  @ApiOperation({ summary: 'Listar adjudicaciones y cola de reclamaciones' })
  listAwards(@Query() query: ListAdminPrizeAwardsDto) {
    return this.prizes.listAdminAwards(query);
  }

  @Get('awards/:publicId')
  @ApiOperation({ summary: 'Consultar una adjudicación por su publicId' })
  findAward(@Param('publicId') publicId: string) {
    return this.prizes.findAdminAward(publicId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Consultar una definición de premio' })
  find(@Param('id') id: string) {
    return this.prizes.findAdminPrize(id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateInstantPrizeDto) {
    return this.prizes.update(id, dto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.prizes.remove(id);
  }

  @Post('awards/:publicId/fulfill')
  fulfill(@Param('publicId') publicId: string) {
    return this.prizes.fulfill(publicId);
  }
}
