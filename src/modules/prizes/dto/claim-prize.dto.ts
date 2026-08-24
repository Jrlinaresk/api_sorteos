import { IsUUID } from 'class-validator';

export class ClaimPrizeDto {
  @IsUUID()
  orderPublicId: string;
}
