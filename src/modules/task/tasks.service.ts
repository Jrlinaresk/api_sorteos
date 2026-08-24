import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { RafflesService } from '../riffles/raffles.service';

@Injectable()
export class TasksService {
  private readonly logger = new Logger(TasksService.name);

  constructor(private readonly campaigns: RafflesService) {}

  @Cron('0 * * * * *')
  async handleCampaignLifecycle() {
    const result = await this.campaigns.processLifecycle();
    if (
      result.activated ||
      result.soldOut ||
      result.awaitingDraw ||
      result.activationBlocked
    ) {
      this.logger.log(
        `Ciclo de campañas actualizado: ${JSON.stringify(result)}`,
      );
    }
    return result;
  }
}
