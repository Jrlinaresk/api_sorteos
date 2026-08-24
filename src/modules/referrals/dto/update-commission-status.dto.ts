import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { ReferralCommissionStatus } from '../schemas/referral-commission.schema';

export class UpdateCommissionStatusDto {
  @ApiProperty({ enum: ReferralCommissionStatus })
  @IsEnum(ReferralCommissionStatus)
  status: ReferralCommissionStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
