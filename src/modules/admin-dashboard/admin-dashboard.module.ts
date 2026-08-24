import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AuthModule } from '../auth/auth.module';
import {
  MainPrizeAward,
  MainPrizeAwardSchema,
} from '../main-awards/schemas/main-prize-award.schema';
import { Order, OrderSchema } from '../orders/schemas/order.schema';
import { Payment, PaymentSchema } from '../payments/schemas/payment.schema';
import {
  PrizeAward,
  PrizeAwardSchema,
} from '../prizes/schemas/prize-award.schema';
import { Raffle, RaffleSchema } from '../riffles/schema/raffle.schema';
import { User, UserSchema } from '../users/schemas/user.schema';
import { AdminDashboardController } from './admin-dashboard.controller';
import { AdminDashboardService } from './admin-dashboard.service';

@Module({
  imports: [
    AuthModule,
    MongooseModule.forFeature([
      { name: Raffle.name, schema: RaffleSchema },
      { name: Order.name, schema: OrderSchema },
      { name: Payment.name, schema: PaymentSchema },
      { name: User.name, schema: UserSchema },
      { name: PrizeAward.name, schema: PrizeAwardSchema },
      { name: MainPrizeAward.name, schema: MainPrizeAwardSchema },
    ]),
  ],
  controllers: [AdminDashboardController],
  providers: [AdminDashboardService],
})
export class AdminDashboardModule {}
