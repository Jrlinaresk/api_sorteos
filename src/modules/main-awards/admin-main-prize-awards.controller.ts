import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { PublicUserDto } from '../users/dto/public-user.dto';
import { UserRole } from '../users/enums/user-role.enum';
import { FulfillMainPrizeDto } from './dto/fulfill-main-prize.dto';
import { ListMainPrizeAwardsDto } from './dto/list-main-prize-awards.dto';
import { MainPrizeAwardsService } from './main-prize-awards.service';

@ApiTags('Admin main prize awards')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
@Controller('admin/main-awards')
export class AdminMainPrizeAwardsController {
  constructor(private readonly awards: MainPrizeAwardsService) {}

  @Get()
  @ApiOperation({ summary: 'Listar contratos de entrega del premio principal' })
  list(@Query() query: ListMainPrizeAwardsDto) {
    return this.awards.listAdmin(query);
  }

  @Get(':publicId')
  @ApiOperation({
    summary: 'Consultar la trazabilidad completa de una entrega',
  })
  find(@Param('publicId') publicId: string) {
    return this.awards.findAdmin(publicId);
  }

  @Post(':publicId/fulfill')
  @ApiOperation({ summary: 'Registrar la entrega material o transferencia' })
  fulfill(
    @Param('publicId') publicId: string,
    @Body() dto: FulfillMainPrizeDto,
    @CurrentUser() actor: PublicUserDto,
  ) {
    return this.awards.fulfill(publicId, dto, actor.id);
  }
}
