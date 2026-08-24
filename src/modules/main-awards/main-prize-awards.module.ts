import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AuthModule } from '../auth/auth.module';
import { EmailModule } from '../email/email.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { OrdersModule } from '../orders/orders.module';
import { Order, OrderSchema } from '../orders/schemas/order.schema';
import { Quota, QuotaSchema } from '../orders/schemas/quota.schema';
import { AdminMainPrizeAwardsController } from './admin-main-prize-awards.controller';
import { MainPrizeAwardsController } from './main-prize-awards.controller';
import { MainPrizeAwardsService } from './main-prize-awards.service';
import {
  MainPrizeAward,
  MainPrizeAwardSchema,
} from './schemas/main-prize-award.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: MainPrizeAward.name, schema: MainPrizeAwardSchema },
      { name: Order.name, schema: OrderSchema },
      { name: Quota.name, schema: QuotaSchema },
    ]),
    AuthModule,
    OrdersModule,
    NotificationsModule,
    EmailModule,
  ],
  controllers: [MainPrizeAwardsController, AdminMainPrizeAwardsController],
  providers: [MainPrizeAwardsService],
  exports: [MainPrizeAwardsService, MongooseModule],
})
export class MainPrizeAwardsModule {}
