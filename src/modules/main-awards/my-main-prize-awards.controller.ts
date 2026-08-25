import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PublicUserDto } from '../users/dto/public-user.dto';
import { ListMyMainPrizeAwardsDto } from './dto/list-my-main-prize-awards.dto';
import { MainPrizeAwardsService } from './main-prize-awards.service';

@ApiTags('My participation')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('me')
export class MyMainPrizeAwardsController {
  constructor(private readonly awards: MainPrizeAwardsService) {}

  @Get('main-awards')
  @ApiOperation({
    summary:
      'Listar premios principales por propiedad actual de los pedidos de la cuenta',
  })
  list(
    @CurrentUser() user: PublicUserDto,
    @Query() query: ListMyMainPrizeAwardsDto,
  ) {
    return this.awards.listMine(user.id, query);
  }
}
