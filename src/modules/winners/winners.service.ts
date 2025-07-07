/* src/modules/winners/winners.service.ts */
import {
  ConflictException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { WinnerMessages } from './enums/winner-messages.enum';
import { Raffle, RaffleDocument } from '../riffles/schema/raffle.schema';

@Injectable()
export class WinnersService {
  private readonly logger = new Logger(WinnersService.name);

  constructor(
    @InjectModel(Raffle.name) private raffleModel: Model<RaffleDocument>,
  ) {}

  /**
   * Sortea los ganadores de una rifa: cierra la rifa y elige aleatoriamente participantes.
   */
  async drawWinners(raffleId: string): Promise<RaffleDocument> {
    this.logger.debug(`drawWinners iniciada para raffleId=${raffleId}`);

    let raffle: RaffleDocument | null;
    try {
      raffle = await this.raffleModel.findById(raffleId).exec();
      this.logger.debug(
        `Raffle cargada: ${raffle ? raffle._id : 'no encontrada'}`,
      );
    } catch (err) {
      this.logger.error(
        `Error al buscar raffle ${raffleId}: ${err.message}`,
        err.stack,
      );
      throw new InternalServerErrorException('Error al leer la rifa');
    }

    if (!raffle) {
      this.logger.warn(`RaffleId ${raffleId} no existe`);
      throw new NotFoundException(WinnerMessages.RAFFLE_NOT_FOUND);
    }

    // Validación de estado/participantes
    const hasWinners =
      Array.isArray(raffle.winners) && raffle.winners.length > 0;
    this.logger.debug(
      `Estado previo: status=${raffle.status}, winnersCount=${raffle.winners?.length || 0}`,
    );

    if (raffle.status !== 'open' && hasWinners) {
      this.logger.warn(`Rifa ${raffleId} ya cerrada con ganadores`);
      throw new ConflictException(WinnerMessages.ALREADY_DREW);
    }
    if (raffle.participants.length === 0) {
      this.logger.warn(`Rifa ${raffleId} sin participantes`);
      throw new ConflictException(WinnerMessages.NO_PARTICIPANTS);
    }

    // Sorteo
    try {
      raffle.status = 'closed';
      const shuffled = raffle.participants.sort(() => 0.5 - Math.random());
      raffle.winners = shuffled.slice(0, 1);
      this.logger.debug(`Ganadores seleccionados: ${raffle.winners}`);
    } catch (err) {
      this.logger.error(
        `Error al seleccionar ganadores: ${err.message}`,
        err.stack,
      );
      throw new InternalServerErrorException('Error al sortear ganadores');
    }

    // Guardar cambios
    try {
      await raffle.save();
      this.logger.log(
        `Rifa ${raffleId} guardada con status=closed y winners=${raffle.winners}`,
      );
    } catch (err) {
      this.logger.error(
        `Error al guardar raffle ${raffleId}: ${err.message}`,
        err.stack,
      );
      throw new InternalServerErrorException(
        'Error al guardar resultados de sorteo',
      );
    }

    // Población de datos de winners
    try {
      await raffle.populate({ path: 'winners', select: 'phone nickname' });
      this.logger.debug(`Winners poblados: ${JSON.stringify(raffle.winners)}`);
    } catch (err) {
      this.logger.error(
        `Error al popular winners para raffle ${raffleId}: ${err.message}`,
        err.stack,
      );
      // No interrumpimos, devolvemos de todos modos
    }

    this.logger.debug(`drawWinners finalizada para raffleId=${raffleId}`);
    return raffle;
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
