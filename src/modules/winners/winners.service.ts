import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { WinnerMessages } from './enums/winner-messages.enum';
import { Raffle, RaffleDocument } from '../riffles/schema/raffle.schema';

/**
 * Adaptador de compatibilidad para clientes antiguos.
 *
 * El antiguo servicio escogía ganadores con Math.random(), sin una fuente
 * verificable ni prueba auditable. Esa operación queda deliberadamente
 * bloqueada. Los sorteos válidos se verifican y publican mediante DrawsModule.
 */
@Injectable()
export class WinnersService {
  constructor(
    @InjectModel(Raffle.name) private readonly raffleModel: Model<RaffleDocument>,
  ) {}

  async drawWinners(raffleId: string): Promise<never> {
    const exists = await this.raffleModel.exists({ _id: raffleId });
    if (!exists) throw new NotFoundException(WinnerMessages.RAFFLE_NOT_FOUND);
    throw new ConflictException(
      'El sorteo aleatorio heredado está deshabilitado. Use la verificación y publicación auditable de resultados.',
    );
  }

  async getWinners(raffleId: string) {
    const campaign = await this.raffleModel
      .findById(raffleId)
      .select('status winners winningQuotaNumber resultPublishedAt')
      .populate('winners', 'nickname firstName')
      .lean();
    if (!campaign) throw new NotFoundException(WinnerMessages.RAFFLE_NOT_FOUND);
    return {
      status: campaign.status,
      winningQuotaNumber: campaign.winningQuotaNumber,
      publishedAt: campaign.resultPublishedAt,
      winners: campaign.winners || [],
    };
  }
}
