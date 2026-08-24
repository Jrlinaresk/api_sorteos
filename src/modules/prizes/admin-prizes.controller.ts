import { Body, Controller, Delete, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserRole } from '../users/enums/user-role.enum';
import { CreateInstantPrizeDto } from './dto/create-instant-prize.dto';
import { UpdateInstantPrizeDto } from './dto/update-instant-prize.dto';
import { PrizesService } from './prizes.service';

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
