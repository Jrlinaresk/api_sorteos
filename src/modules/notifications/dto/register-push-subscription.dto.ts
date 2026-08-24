import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsDateString,
  IsEnum,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { PushProviderKind } from '../schemas/push-subscription.schema';

export class RegisterPushSubscriptionDto {
  @ApiProperty({ enum: PushProviderKind })
  @IsEnum(PushProviderKind)
  provider: PushProviderKind;

  @ApiProperty({ description: 'Endpoint o token opaco' })
  @IsString()
  @MinLength(1)
  @MaxLength(4096)
  address: string;

  @ApiPropertyOptional({
    description:
      'Para web_push: objeto con exactamente las claves p256dh y auth en Base64 URL-safe',
    example: { p256dh: '...', auth: '...' },
  })
  @IsOptional()
  @IsObject()
  credentials?: Record<string, string>;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  deviceId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(30)
  locale?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  timezone?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  expiresAt?: string;
}
