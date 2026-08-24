import { ApiProperty } from '@nestjs/swagger';
import { IsEnum } from 'class-validator';
import { MainPrizeChoice } from '../schemas/main-prize-award.schema';

export class ClaimMainPrizeDto {
  @ApiProperty({ enum: MainPrizeChoice })
  @IsEnum(MainPrizeChoice)
  choice: MainPrizeChoice;
}
