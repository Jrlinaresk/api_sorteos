import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AuthModule } from '../auth/auth.module';
import { OrdersModule } from '../orders/orders.module';
import { Order, OrderSchema } from '../orders/schemas/order.schema';
import { Quota, QuotaSchema } from '../orders/schemas/quota.schema';
import { Raffle, RaffleSchema } from '../riffles/schema/raffle.schema';
import { AdminPrizesController } from './admin-prizes.controller';
import { PrizesController } from './prizes.controller';
import { PrizesService } from './prizes.service';
import { InstantPrize, InstantPrizeSchema } from './schemas/instant-prize.schema';
import { PrizeAttempt, PrizeAttemptSchema } from './schemas/prize-attempt.schema';
import { PrizeAward, PrizeAwardSchema } from './schemas/prize-award.schema';
import { MediaModule } from '../media/media.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: InstantPrize.name, schema: InstantPrizeSchema },
      { name: PrizeAttempt.name, schema: PrizeAttemptSchema },
      { name: PrizeAward.name, schema: PrizeAwardSchema },
      { name: Raffle.name, schema: RaffleSchema },
      { name: Order.name, schema: OrderSchema },
      { name: Quota.name, schema: QuotaSchema },
    ]),
    OrdersModule,
    AuthModule,
    MediaModule,
  ],
  controllers: [PrizesController, AdminPrizesController],
  providers: [PrizesService],
  exports: [PrizesService, MongooseModule],
})
export class PrizesModule {}
