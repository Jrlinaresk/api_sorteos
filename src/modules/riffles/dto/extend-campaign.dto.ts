import {
  IsDateString,
  IsNotEmpty,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';

export class ExtendCampaignDto {
  @IsDateString()
  closesAt: string;

  @IsString()
  @IsNotEmpty()
  @Matches(/\S/)
  @MaxLength(500)
  reason: string;
}
