import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AuthModule } from '../auth/auth.module';
import { Order, OrderSchema } from '../orders/schemas/order.schema';
import { Quota, QuotaSchema } from '../orders/schemas/quota.schema';
import { Raffle, RaffleSchema } from '../riffles/schema/raffle.schema';
import { AdminDrawsController } from './admin-draws.controller';
import { DrawsController } from './draws.controller';
import { DrawsService } from './draws.service';
import { DrawResult, DrawResultSchema } from './schemas/draw-result.schema';
import { NotificationsModule } from '../notifications/notifications.module';
import { ResultsController } from './results.controller';
import { CaixaFederalLotteryModule } from './caixa-federal-lottery.module';
import { EntropyBeaconService } from './entropy-beacon.service';
import { MainPrizeAwardsModule } from '../main-awards/main-prize-awards.module';
import { Payment, PaymentSchema } from '../payments/schemas/payment.schema';
import {
  RefundOperation,
  RefundOperationSchema,
} from '../payments/schemas/refund-operation.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: DrawResult.name, schema: DrawResultSchema },
      { name: Raffle.name, schema: RaffleSchema },
      { name: Quota.name, schema: QuotaSchema },
      { name: Order.name, schema: OrderSchema },
      { name: Payment.name, schema: PaymentSchema },
      { name: RefundOperation.name, schema: RefundOperationSchema },
    ]),
    AuthModule,
    NotificationsModule,
    CaixaFederalLotteryModule,
    MainPrizeAwardsModule,
  ],
  controllers: [DrawsController, ResultsController, AdminDrawsController],
  providers: [DrawsService, EntropyBeaconService],
  exports: [DrawsService, MongooseModule],
})
export class DrawsModule {}
