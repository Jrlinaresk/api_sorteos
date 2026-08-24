import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNumber, IsOptional, Matches, MaxLength, Min } from 'class-validator';

export class RefundPaymentDto {
  @ApiProperty({ description: 'Clave única para este intento de devolución' })
  @Matches(/^[A-Za-z0-9._:-]{8,128}$/)
  idempotencyKey: string;

  @ApiPropertyOptional({
    description: 'Omitir para devolver el saldo completo',
  })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  amount?: number;

  @ApiPropertyOptional({ maxLength: 140 })
  @IsOptional()
  @MaxLength(140)
  reason?: string;
}
