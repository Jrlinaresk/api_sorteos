import { Type } from 'class-transformer';
import {
  IsEmail,
  IsInt,
  IsMongoId,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

export class BuyerDto {
  @IsString()
  @Length(2, 160)
  name: string;

  @IsString()
  @Matches(/^\+?[1-9]\d{7,14}$/)
  phone: string;

  @IsEmail()
  @MaxLength(180)
  email: string;

  @IsString()
  @Matches(/^\d{11}$/)
  cpf: string;
}

export class AttributionDto {
  @IsOptional()
  @IsString()
  @MaxLength(80)
  referralCode?: string;

  @IsOptional()
  @IsMongoId()
  referralClickId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  source?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  medium?: string;

  @IsOptional()
  @IsString()
  @MaxLength(180)
  campaign?: string;

  @IsOptional()
  @IsString()
  @MaxLength(180)
  content?: string;

  @IsOptional()
  @IsString()
  @MaxLength(180)
  term?: string;

  @IsOptional()
  @IsString()
  @MaxLength(220)
  fbclid?: string;

  @IsOptional()
  @IsString()
  @MaxLength(220)
  gclid?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  landingPage?: string;
}

export class CreateOrderDto {
  @IsString()
  @Length(1, 120)
  campaignSlug: string;

  @IsInt()
  @Min(1)
  @Max(100000)
  quantity: number;

  @ValidateNested()
  @Type(() => BuyerDto)
  buyer: BuyerDto;

  @IsString()
  @Length(1, 40)
  termsVersion: string;

  @IsOptional()
  @IsString()
  @Length(8, 160)
  idempotencyKey?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => AttributionDto)
  attribution?: AttributionDto;
}
