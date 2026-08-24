import { Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsMongoId,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  DEFAULT_PAYMENT_EXPIRATION_SECONDS,
  MAX_PAYMENT_EXPIRATION_SECONDS,
  MIN_PAYMENT_EXPIRATION_SECONDS,
} from '../payment.constants';
import { PaymentCurrency, PaymentProviderName } from '../payment.enums';

export class PixPayerDto {
  @ApiProperty({ example: 'Maria da Silva' })
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  name: string;

  @ApiPropertyOptional({ description: 'CPF, solo dígitos' })
  @IsOptional()
  @Matches(/^\d{11}$/)
  cpf?: string;

  @ApiPropertyOptional({ description: 'CNPJ, solo dígitos' })
  @IsOptional()
  @Matches(/^\d{14}$/)
  cnpj?: string;
}

export class CreatePaymentDto {
  @ApiProperty()
  @IsMongoId()
  orderId: string;

  @ApiProperty()
  @IsMongoId()
  campaignId: string;

  @ApiPropertyOptional({ description: 'Ausente para compras guest' })
  @IsOptional()
  @IsMongoId()
  userId?: string;

  @ApiProperty({ example: 34.99, minimum: 0.01 })
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  amount: number;

  @ApiPropertyOptional({ enum: PaymentCurrency, default: PaymentCurrency.BRL })
  @IsOptional()
  @IsEnum(PaymentCurrency)
  currency?: PaymentCurrency = PaymentCurrency.BRL;

  @ApiProperty({ description: '8-128 caracteres; estable por pedido/intento' })
  @Matches(/^[A-Za-z0-9._:-]{8,128}$/)
  idempotencyKey: string;

  @ApiPropertyOptional({ enum: PaymentProviderName })
  @IsOptional()
  @IsEnum(PaymentProviderName)
  provider?: PaymentProviderName;

  @ApiPropertyOptional({ default: DEFAULT_PAYMENT_EXPIRATION_SECONDS })
  @IsOptional()
  @IsInt()
  @Min(MIN_PAYMENT_EXPIRATION_SECONDS)
  @Max(MAX_PAYMENT_EXPIRATION_SECONDS)
  expiresInSeconds?: number = DEFAULT_PAYMENT_EXPIRATION_SECONDS;

  @ApiPropertyOptional({ maxLength: 140 })
  @IsOptional()
  @IsString()
  @MaxLength(140)
  description?: string;

  @ApiPropertyOptional({ type: PixPayerDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => PixPayerDto)
  payer?: PixPayerDto;
}
