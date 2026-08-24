import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

export class FulfillMainPrizeDto {
  @ApiPropertyOptional({
    description: 'Comprobante, transferencia, tracking o acta de entrega',
  })
  @IsOptional()
  @IsString()
  @MaxLength(160)
  reference?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;
}
