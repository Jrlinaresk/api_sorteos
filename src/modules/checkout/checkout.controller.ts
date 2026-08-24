import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Post,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CancelOrderDto } from '../orders/dto/cancel-order.dto';
import { CheckoutService } from './checkout.service';
import { CreateCheckoutDto } from './dto/create-checkout.dto';
import { Throttle } from '@nestjs/throttler';
import { UseGuards } from '@nestjs/common';
import { OptionalJwtAuthGuard } from '../auth/guards/optional-jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { PublicUserDto } from '../users/dto/public-user.dto';

@ApiTags('Public checkout')
@UseGuards(OptionalJwtAuthGuard)
@Controller('checkout')
export class CheckoutController {
  constructor(private readonly checkout: CheckoutService) {}

  @Post()
  @Throttle({
    default: { limit: 10, ttl: 60 * 1000, blockDuration: 60 * 1000 },
  })
  @ApiOperation({
    summary: 'Reservar cuotas y crear un cobro Pix idempotente',
  })
  @UsePipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
    }),
  )
  create(@Body() dto: CreateCheckoutDto, @CurrentUser() user?: PublicUserDto) {
    return this.checkout.create(dto, user?.id);
  }

  @Get(':publicId')
  @ApiHeader({ name: 'X-Order-Token', required: true })
  @ApiOperation({ summary: 'Consultar pedido y pago mediante token opaco' })
  find(
    @Param('publicId') publicId: string,
    @Headers('x-order-token') orderAccessToken: string,
    @CurrentUser() user?: PublicUserDto,
  ) {
    return this.checkout.find(publicId, orderAccessToken, user?.id);
  }

  @Post(':publicId/cancel')
  @ApiHeader({ name: 'X-Order-Token', required: true })
  @ApiOperation({ summary: 'Cancelar el Pix y liberar la reserva' })
  cancel(
    @Param('publicId') publicId: string,
    @Headers('x-order-token') orderAccessToken: string,
    @Body() dto: CancelOrderDto,
    @CurrentUser() user?: PublicUserDto,
  ) {
    return this.checkout.cancel(publicId, orderAccessToken, dto, user?.id);
  }
}
