import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PublicUserDto } from '../users/dto/public-user.dto';
import { ListOrdersDto } from './dto/list-orders.dto';
import { ListMyTitlesDto } from './dto/list-my-titles.dto';
import { OrdersService } from './orders.service';

@ApiTags('My participation')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('me')
export class MyOrdersController {
  constructor(private readonly orders: OrdersService) {}

  @Get('orders')
  list(@CurrentUser() user: PublicUserDto, @Query() query: ListOrdersDto) {
    return this.orders.listMine(user.id, query);
  }

  @Get('orders/:publicId')
  find(
    @CurrentUser() user: PublicUserDto,
    @Param('publicId') publicId: string,
  ) {
    return this.orders.findByPublicId(publicId, undefined, user.id);
  }

  @Get('titles')
  titles(@CurrentUser() user: PublicUserDto, @Query() query: ListMyTitlesDto) {
    return this.orders.getMyTitles(user.id, query);
  }
}
