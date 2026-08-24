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

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: DrawResult.name, schema: DrawResultSchema },
      { name: Raffle.name, schema: RaffleSchema },
      { name: Quota.name, schema: QuotaSchema },
      { name: Order.name, schema: OrderSchema },
    ]),
    AuthModule,
    NotificationsModule,
  ],
  controllers: [DrawsController, ResultsController, AdminDrawsController],
  providers: [DrawsService],
  exports: [DrawsService, MongooseModule],
})
export class DrawsModule {}
