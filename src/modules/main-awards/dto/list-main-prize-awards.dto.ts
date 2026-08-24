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

export class ListMainPrizeAwardsDto {
  @ApiPropertyOptional({ default: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;

  @ApiPropertyOptional({ enum: MainPrizeAwardStatus })
  @IsOptional()
  @IsEnum(MainPrizeAwardStatus)
  status?: MainPrizeAwardStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsMongoId()
  campaignId?: string;
}
