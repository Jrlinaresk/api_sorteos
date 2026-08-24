import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { OrdersModule } from '../orders/orders.module';
import { PaymentsModule } from '../payments/payments.module';
import { PrizesModule } from '../prizes/prizes.module';
import { ReferralsModule } from '../referrals/referrals.module';
import { FulfillmentService } from './fulfillment.service';

@Module({
  imports: [OrdersModule, PaymentsModule, PrizesModule, ReferralsModule, NotificationsModule],
  providers: [FulfillmentService],
})
export class FulfillmentModule {}
