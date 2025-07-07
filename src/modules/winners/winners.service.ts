/* src/modules/winners/winners.service.ts */
import {
  Injectable,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { WinnerMessages } from './enums/winner-messages.enum';
import { Raffle, RaffleDocument } from '../riffles/schema/raffle.schema';

@Injectable()
export class WinnersService {
  constructor(
    @InjectModel(Raffle.name) private raffleModel: Model<RaffleDocument>,
  ) {}

  /**
   * Sortea los ganadores de una rifa: cierra la rifa y elige aleatoriamente participantes.
   */
  async drawWinners(raffleId: string): Promise<Raffle> {
    const raffle = await this.raffleModel.findById(raffleId).exec();
    if (!raffle) throw new NotFoundException(WinnerMessages.RAFFLE_NOT_FOUND);

    if (raffle.status !== 'open') {
      throw new ConflictException(WinnerMessages.ALREADY_DREW);
    }

    const count = raffle.participants.length;
    if (count === 0) {
      throw new ConflictException(WinnerMessages.NO_PARTICIPANTS);
    }

    // Cerrar la rifa
    raffle.status = 'closed';

    // Selección de ganadores: por defecto 1 ganador
    const winnerCount = 1;
    const shuffled = raffle.participants.sort(() => 0.5 - Math.random());
    raffle.winners = shuffled
      .slice(0, winnerCount)
      .map((id) => new Types.ObjectId(id));

    return raffle.save();
  }

  /**
   * Devuelve la lista de ganadores
   */
  async getWinners(raffleId: string): Promise<Types.ObjectId[]> {
    const raffle = await this.raffleModel.findById(raffleId).exec();
    if (!raffle) throw new NotFoundException(WinnerMessages.RAFFLE_NOT_FOUND);
    // Aseguramos que siempre devuelva un array
    return raffle.winners ?? [];
  }
}
