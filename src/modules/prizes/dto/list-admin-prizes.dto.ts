import { Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsMongoId,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import {
  InstantPrizeStatus,
  PrizeMechanic,
} from '../schemas/instant-prize.schema';
import { PrizeAwardStatus } from '../schemas/prize-award.schema';

class AdminPrizePageDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit = 50;

  @IsOptional()
  @IsMongoId()
  campaignId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  search?: string;
}

export class ListAdminPrizesDto extends AdminPrizePageDto {
  @IsOptional()
  @IsEnum(PrizeMechanic)
  mechanic?: PrizeMechanic;

  @IsOptional()
  @IsEnum(InstantPrizeStatus)
  status?: InstantPrizeStatus;
}

export class ListAdminPrizeAwardsDto extends AdminPrizePageDto {
  @IsOptional()
  @IsEnum(PrizeAwardStatus)
  status?: PrizeAwardStatus;
}
