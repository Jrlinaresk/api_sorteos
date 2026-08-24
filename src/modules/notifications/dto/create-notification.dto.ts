import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsMongoId,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';
import { NotificationType } from '../schemas/notification.schema';

export class CreateNotificationDto {
  @ApiProperty()
  @IsMongoId()
  userId: string;

  @ApiProperty()
  @IsString()
  @MaxLength(140)
  title: string;

  @ApiProperty()
  @IsString()
  @MaxLength(2000)
  body: string;

  @ApiPropertyOptional({ enum: NotificationType })
  @IsOptional()
  @IsEnum(NotificationType)
  type?: NotificationType;

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  data?: Record<string, unknown>;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2048)
  imageUrl?: string;

  @ApiPropertyOptional({ description: 'URL absoluta o ruta interna' })
  @IsOptional()
  @IsString()
  @Matches(/^(https?:\/\/|\/)/, {
    message: 'actionUrl debe ser una URL HTTP(S) o una ruta interna',
  })
  @MaxLength(2048)
  actionUrl?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  expiresAt?: string;

  @ApiPropertyOptional({
    description: 'Intenta entregar por push después de persistir el inbox',
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  deliverPush?: boolean;
}
