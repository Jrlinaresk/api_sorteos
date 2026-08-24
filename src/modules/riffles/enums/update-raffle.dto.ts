/* src/modules/raffles/dto/update-raffle.dto.ts */
import { PartialType } from '@nestjs/mapped-types';
import { CreateRaffleDto } from '../dto/create-raffle.dto';

export class UpdateRaffleDto extends PartialType(CreateRaffleDto) {}
