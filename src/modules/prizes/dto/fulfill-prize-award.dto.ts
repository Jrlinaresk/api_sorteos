import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';

export class FulfillPrizeAwardDto {
  @ApiProperty({
    description: 'Comprobante, transferencia, tracking o acta de entrega',
    maxLength: 160,
  })
  @IsString()
  @IsNotEmpty()
  @Matches(/\S/)
  @MaxLength(160)
  reference: string;

  @ApiPropertyOptional({ maxLength: 1000 })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;
}
