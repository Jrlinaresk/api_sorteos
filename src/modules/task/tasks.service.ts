/* src/modules/tasks/tasks.service.ts */
import { Injectable, Logger } from '@nestjs/common';
import { WinnersService } from '../winners/winners.service';
import { RafflesService } from '../riffles/raffles.service';
import { Raffle } from '../riffles/schema/raffle.schema';

@Injectable()
export class TasksService {
  private readonly logger = new Logger(TasksService.name);

  constructor(
    private readonly rafflesService: RafflesService,
    private readonly winnersService: WinnersService,
  ) {}

  /**
   * Tarea programada cada minuto.
   * Cierra rifas con cupo completo o fecha de sorteo alcanzada.
   */
  async handleRafflesAutomation() {
    this.logger.debug('Iniciando tarea de automatización de rifas');

    const all: Raffle[] = await this.rafflesService.findAll();
    const now = new Date();

    for (const raffle of all) {
      if (raffle.status === 'open') {
        const full = raffle.participants.length >= raffle.maxParticipants;
        const due = raffle.drawDate && raffle.drawDate <= now;

        if (full || due) {
          try {
            await this.winnersService.drawWinners(raffle.id.toString());
            this.logger.log(`Rifa ${raffle._id} sorteada automáticamente`);
          } catch (err) {
            this.logger.error(
              `Error al sortear rifa ${raffle._id}: ${err.message}`,
            );
          }
        }
      }
    }
  }
}
