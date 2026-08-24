import { IsInt, Max, Min } from 'class-validator';

export class QuoteCampaignDto {
  @IsInt()
  @Min(1)
  @Max(100000)
  quantity: number;
}
