import { Body, Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { OptionalJwtAuthGuard } from '../auth/guards/optional-jwt-auth.guard';
import { PublicUserDto } from '../users/dto/public-user.dto';
import { ConfirmOrderAccessDto } from './dto/confirm-order-access.dto';
import { RequestOrderAccessDto } from './dto/request-order-access.dto';
import { OrderAccessService } from './order-access.service';

@ApiTags('Guest order access')
@Controller('orders/access')
export class OrderAccessController {
  constructor(private readonly orderAccess: OrderAccessService) {}

  @Post('request')
  @HttpCode(202)
  @Throttle({
    default: {
      limit: 3,
      ttl: 15 * 60 * 1000,
      blockDuration: 15 * 60 * 1000,
    },
  })
  @ApiOperation({
    summary: 'Solicitar un código para recuperar pedidos de invitado',
  })
  request(@Body() dto: RequestOrderAccessDto) {
    return this.orderAccess.request(dto);
  }

  @Post('confirm')
  @HttpCode(200)
  @UseGuards(OptionalJwtAuthGuard)
  @ApiBearerAuth()
  @Throttle({
    default: {
      limit: 10,
      ttl: 15 * 60 * 1000,
      blockDuration: 15 * 60 * 1000,
    },
  })
  @ApiOperation({
    summary: 'Confirmar el código y rotar los tokens de los pedidos',
  })
  confirm(
    @Body() dto: ConfirmOrderAccessDto,
    @CurrentUser() user?: PublicUserDto,
  ) {
    return this.orderAccess.confirm(dto, user);
  }
}
