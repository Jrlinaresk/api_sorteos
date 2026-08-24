import { ApiPropertyOptional, OmitType } from '@nestjs/swagger';
import {
  IsEnum,
  IsMongoId,
  IsNumberString,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { ReferralCodeStatus } from '../schemas/referral-code.schema';
import { ReferralCommissionStatus } from '../schemas/referral-commission.schema';

export class ReferralPaginationQueryDto {
  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @IsNumberString({ no_symbols: true })
  page?: string;

  @ApiPropertyOptional({ default: 20, maximum: 100 })
  @IsOptional()
  @IsNumberString({ no_symbols: true })
  limit?: string;
}

export class ListReferralCodesQueryDto extends ReferralPaginationQueryDto {
  @ApiPropertyOptional({ enum: ReferralCodeStatus })
  @IsOptional()
  @IsEnum(ReferralCodeStatus)
  status?: ReferralCodeStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsMongoId()
  beneficiaryUserId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsMongoId()
  campaignId?: string;
}

export class ListReferralClicksQueryDto extends ReferralPaginationQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(32)
  code?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  utmCampaign?: string;
}

export class ListReferralCommissionsQueryDto extends ReferralPaginationQueryDto {
  @ApiPropertyOptional({ enum: ReferralCommissionStatus })
  @IsOptional()
  @IsEnum(ReferralCommissionStatus)
  status?: ReferralCommissionStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsMongoId()
  beneficiaryUserId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(120)
  orderId?: string;
}

/** La superficie de usuario no permite elegir otro beneficiario. */
export class ListMyReferralCommissionsQueryDto extends OmitType(
  ListReferralCommissionsQueryDto,
  ['beneficiaryUserId'] as const,
) {}
