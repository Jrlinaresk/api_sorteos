import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { PaymentsWebhookGuard } from './guards/payments-webhook.guard';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';
import { EfiPaymentProvider } from './providers/efi-payment.provider';
import { MockPaymentProvider } from './providers/mock-payment.provider';
import { PaymentProviderFactory } from './providers/payment-provider.factory';
import { Payment, PaymentSchema } from './schemas/payment.schema';
import { AuthModule } from '../auth/auth.module';
import { Order, OrderSchema } from '../orders/schemas/order.schema';
import { Raffle, RaffleSchema } from '../riffles/schema/raffle.schema';
import {
  PrizeAward,
  PrizeAwardSchema,
} from '../prizes/schemas/prize-award.schema';

@Module({
  imports: [
    ConfigModule,
    AuthModule,
    MongooseModule.forFeature([
      { name: Payment.name, schema: PaymentSchema },
      { name: Order.name, schema: OrderSchema },
      { name: Raffle.name, schema: RaffleSchema },
      { name: PrizeAward.name, schema: PrizeAwardSchema },
    ]),
  ],
  controllers: [PaymentsController],
  providers: [
    PaymentsService,
    PaymentProviderFactory,
    MockPaymentProvider,
    EfiPaymentProvider,
    PaymentsWebhookGuard,
  ],
  exports: [PaymentsService, PaymentProviderFactory],
})
export class PaymentsModule {}
