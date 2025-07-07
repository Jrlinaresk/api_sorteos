/* src/modules/winners/dto/draw-winner.dto.ts */
import { ApiProperty } from '@nestjs/swagger';
import { IsMongoId } from 'class-validator';

export class DrawWinnerDto {
  @ApiProperty({ description: 'ID de la rifa a sortear' })
  @IsMongoId()
  raffleId: string;
}
