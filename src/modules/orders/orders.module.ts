import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { RafflesModule } from '../riffles/riffles.module';
import { Raffle, RaffleSchema } from '../riffles/schema/raffle.schema';
import { Order, OrderSchema } from './schemas/order.schema';
import { Quota, QuotaSchema } from './schemas/quota.schema';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';
import { MyOrdersController } from './my-orders.controller';
import { AdminOrdersController } from './admin-orders.controller';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Order.name, schema: OrderSchema },
      { name: Quota.name, schema: QuotaSchema },
      { name: Raffle.name, schema: RaffleSchema },
    ]),
    RafflesModule,
    AuthModule,
  ],
  controllers: [OrdersController, MyOrdersController, AdminOrdersController],
  providers: [OrdersService],
  exports: [OrdersService, MongooseModule],
})
export class OrdersModule {}
