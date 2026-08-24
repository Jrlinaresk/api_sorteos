/* src/modules/raffles/dto/update-raffle.dto.ts */
import { OmitType, PartialType } from '@nestjs/mapped-types';
import { CreateRaffleDto } from '../dto/create-raffle.dto';

export class UpdateRaffleDto extends PartialType(
  OmitType(CreateRaffleDto, ['status'] as const),
) {}
