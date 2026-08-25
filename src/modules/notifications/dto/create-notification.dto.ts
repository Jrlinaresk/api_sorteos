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

  @ApiPropertyOptional({
    description:
      'Clave estable del evento interno; reintentos con el mismo usuario y clave reutilizan el inbox existente',
    example: 'payment:66c123456789012345678901:paid',
  })
  @IsOptional()
  @IsString()
  @Matches(/^[A-Za-z0-9._:-]{8,160}$/, {
    message: 'eventKey debe tener 8-160 caracteres alfanuméricos o . _ : -',
  })
  eventKey?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  data?: Record<string, unknown>;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2048)
  imageUrl?: string;

  @ApiPropertyOptional({ description: 'Ruta interna del portal cliente' })
  @IsOptional()
  @IsString()
  @Matches(/^\/(?!\/)[^\r\n]{0,2047}$/, {
    message: 'actionUrl debe ser una ruta interna que comience por /',
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
