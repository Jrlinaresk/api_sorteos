import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEnum,
  IsIn,
  IsInt,
  IsMongoId,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { MediaKind, SAFE_MEDIA_TYPES } from '../media-types';
import { MediaAssetStatus } from '../schemas/media-asset.schema';

export class ListMediaAssetsDto {
  @ApiPropertyOptional({ default: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ default: 25, minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @ApiPropertyOptional({ enum: MediaAssetStatus })
  @IsOptional()
  @IsEnum(MediaAssetStatus)
  status?: MediaAssetStatus;

  @ApiPropertyOptional({ enum: MediaKind })
  @IsOptional()
  @IsEnum(MediaKind)
  kind?: MediaKind;

  @ApiPropertyOptional({ enum: Object.keys(SAFE_MEDIA_TYPES) })
  @IsOptional()
  @IsIn(Object.keys(SAFE_MEDIA_TYPES))
  mimeType?: string;

  @ApiPropertyOptional({ description: 'ID del usuario que subió el medio' })
  @IsOptional()
  @IsMongoId()
  uploadedBy?: string;

  @ApiPropertyOptional({
    enum: ['true', 'false'],
    description: 'Filtra medios con o sin referencias activas',
  })
  @IsOptional()
  @IsIn(['true', 'false'])
  referenced?: 'true' | 'false';

  @ApiPropertyOptional({
    maxLength: 80,
    description: 'Busca una parte literal del nombre original',
  })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  search?: string;
}
