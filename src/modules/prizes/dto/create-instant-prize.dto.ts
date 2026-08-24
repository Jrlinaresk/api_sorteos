import {
  IsEnum,
  IsInt,
  IsMongoId,
  IsNumber,
  IsOptional,
  IsString,
  IsUrl,
  MaxLength,
  Min,
} from 'class-validator';
import { PrizeMechanic } from '../schemas/instant-prize.schema';

export class CreateInstantPrizeDto {
  @IsMongoId()
  campaignId: string;

  @IsString()
  @MaxLength(180)
  title: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @IsEnum(PrizeMechanic)
  mechanic: PrizeMechanic;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  quotaNumber?: string;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  cashValue?: number;

  @IsOptional()
  @IsString()
  @MaxLength(180)
  alternativeTitle?: string;

  @IsOptional()
  @IsUrl({ protocols: ['https'], require_protocol: true })
  imageUrl?: string;

  @IsOptional()
  @IsMongoId()
  mediaId?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  stock?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  weight?: number;

  @IsOptional()
  @IsInt()
  sortOrder?: number;
}
