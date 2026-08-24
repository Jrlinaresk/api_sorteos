import { Module } from '@nestjs/common';
import { CaixaFederalLotteryService } from './caixa-federal-lottery.service';

/** Adaptador compartido por campañas y sorteos, sin dependencia entre módulos. */
@Module({
  providers: [CaixaFederalLotteryService],
  exports: [CaixaFederalLotteryService],
})
export class CaixaFederalLotteryModule {}
