import { IsEnum } from 'class-validator';
import { CampaignStatus } from '../schema/raffle.schema';

export class ChangeCampaignStatusDto {
  @IsEnum(CampaignStatus)
  status: CampaignStatus;
}
