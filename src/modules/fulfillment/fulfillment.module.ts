import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { OrdersModule } from '../orders/orders.module';
import { PaymentsModule } from '../payments/payments.module';
import { PrizesModule } from '../prizes/prizes.module';
import { ReferralsModule } from '../referrals/referrals.module';
import { FulfillmentService } from './fulfillment.service';
import { EmailModule } from '../email/email.module';

@Module({
  imports: [
    OrdersModule,
    PaymentsModule,
    PrizesModule,
    ReferralsModule,
    NotificationsModule,
    EmailModule,
  ],
  providers: [FulfillmentService],
})
export class FulfillmentModule {}
