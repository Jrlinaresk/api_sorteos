import { ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { IsEnum, IsOptional } from 'class-validator';
import { CreateReferralCodeDto } from './create-referral-code.dto';
import { ReferralCodeStatus } from '../schemas/referral-code.schema';

export class UpdateReferralCodeDto extends PartialType(CreateReferralCodeDto) {
  @ApiPropertyOptional({ enum: ReferralCodeStatus })
  @IsOptional()
  @IsEnum(ReferralCodeStatus)
  status?: ReferralCodeStatus;
}
