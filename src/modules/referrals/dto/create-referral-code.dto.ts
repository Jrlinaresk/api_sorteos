import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsDateString,
  IsInt,
  IsMongoId,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class CreateReferralCodeDto {
  @ApiPropertyOptional({
    description: 'Si se omite, el servidor genera un código seguro',
  })
  @IsOptional()
  @IsString()
  @Matches(/^[A-Za-z0-9_-]{4,32}$/)
  code?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsMongoId()
  beneficiaryUserId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(120)
  label?: string;

  @ApiPropertyOptional({
    description: 'Puntos básicos: 500 representa 5%',
    default: 0,
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10_000)
  commissionRateBps?: number;

  @ApiPropertyOptional({ default: 'BRL' })
  @IsOptional()
  @Matches(/^[A-Za-z]{3}$/)
  currency?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(120)
  campaignId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  validFrom?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  validUntil?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(1)
  maxConversions?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}
