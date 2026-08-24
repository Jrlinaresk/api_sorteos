import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsOptional,
  IsMongoId,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

export class CaptureReferralClickDto {
  @ApiProperty()
  @IsString()
  @Matches(/^[A-Za-z0-9_-]{4,32}$/)
  code: string;

  @ApiProperty({ description: 'Clave idempotente por evento' })
  @IsString()
  @MinLength(8)
  @MaxLength(100)
  eventId: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  visitorId?: string;

  @ApiPropertyOptional({
    description: 'Necesario cuando el código está restringido a una campaña',
  })
  @IsOptional()
  @IsMongoId()
  campaignId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2048)
  landingPath?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2048)
  referrer?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  utmSource?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  utmMedium?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  utmCampaign?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  utmTerm?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  utmContent?: string;
}
