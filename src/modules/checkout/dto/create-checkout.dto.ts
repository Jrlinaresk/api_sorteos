import { OmitType } from '@nestjs/swagger';
import { IsString, Length, Matches } from 'class-validator';
import { CreateOrderDto } from '../../orders/dto/create-order.dto';

export class CreateCheckoutDto extends OmitType(CreateOrderDto, [
  'idempotencyKey',
] as const) {
  @IsString()
  @Length(24, 128)
  @Matches(/^[A-Za-z0-9._:-]{8,128}$/)
  idempotencyKey: string;
}
