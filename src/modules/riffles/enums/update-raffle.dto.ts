/* src/modules/raffles/dto/update-raffle.dto.ts */
import { PartialType } from '@nestjs/mapped-types';
import { ApiProperty } from '@nestjs/swagger';
import { CreateRaffleDto } from '../dto/create-raffle.dto';

export class UpdateRaffleDto extends PartialType(CreateRaffleDto) {
  @ApiProperty({
    description: 'Nuevo estado de la rifa',
    enum: ['open', 'closed', 'cancelled'],
    required: false,
  })
  status?: 'open' | 'closed' | 'cancelled';
}
