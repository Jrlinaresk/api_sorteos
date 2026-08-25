import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsMongoId,
  IsOptional,
  Max,
  Min,
} from 'class-validator';
import { MainPrizeAwardStatus } from '../schemas/main-prize-award.schema';

export class ListMyMainPrizeAwardsDto {
  @ApiPropertyOptional({ default: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 20;

  @ApiPropertyOptional({ enum: MainPrizeAwardStatus })
  @IsOptional()
  @IsEnum(MainPrizeAwardStatus)
  status?: MainPrizeAwardStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsMongoId()
  campaignId?: string;
}
