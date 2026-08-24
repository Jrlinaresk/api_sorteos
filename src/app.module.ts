import { Module, ValidationPipe } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_GUARD, APP_PIPE } from '@nestjs/core';
import { MongooseModule } from '@nestjs/mongoose';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { HealthModule } from './health/health.module';
import { AuditModule } from './modules/audit/audit.module';
import { AuthModule } from './modules/auth/auth.module';
import { CategoriesModule } from './modules/category/categories.module';
import { CheckoutModule } from './modules/checkout/checkout.module';
import { DrawsModule } from './modules/draws/draws.module';
import { FulfillmentModule } from './modules/fulfillment/fulfillment.module';
import { LocationsModule } from './modules/locations/locations.module';
import { MediaModule } from './modules/media/media.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { OrdersModule } from './modules/orders/orders.module';
import { PaymentsModule } from './modules/payments/payments.module';
import { PrizesModule } from './modules/prizes/prizes.module';
import { ReferralsModule } from './modules/referrals/referrals.module';
import { RafflesModule } from './modules/riffles/riffles.module';
import { SettingsModule } from './modules/settings/settings.module';
import { TasksModule } from './modules/task/tasks.module';
import { validateEnvironment } from './config/environment.validation';
import { mongoConnectionOptions } from './config/mongo.config';
import { AdminPanelModule } from './modules/admin-panel/admin-panel.module';
import { AdminDashboardModule } from './modules/admin-dashboard/admin-dashboard.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      envFilePath: [`.env.${process.env.NODE_ENV || 'development'}`, '.env'],
      isGlobal: true,
      cache: true,
      validate: validateEnvironment,
    }),
    MongooseModule.forRootAsync({
      inject: [ConfigService],
      useFactory: mongoConnectionOptions,
    }),
    ScheduleModule.forRoot(),
    ThrottlerModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => [
        {
          ttl: Number(config.get<string>('RATE_LIMIT_WINDOW_MS') || 60_000),
          limit: Number(config.get<string>('RATE_LIMIT_MAX') || 180),
        },
      ],
    }),
    HealthModule,
    AdminPanelModule,
    AdminDashboardModule,
    AuthModule,
    AuditModule,
    SettingsModule,
    CategoriesModule,
    LocationsModule,
    MediaModule,
    RafflesModule,
    OrdersModule,
    PaymentsModule,
    CheckoutModule,
    PrizesModule,
    DrawsModule,
    NotificationsModule,
    ReferralsModule,
    FulfillmentModule,
    TasksModule,
  ],
  providers: [
    {
      provide: APP_PIPE,
      useValue: new ValidationPipe({
        transform: true,
        whitelist: true,
        forbidNonWhitelisted: true,
        forbidUnknownValues: true,
        stopAtFirstError: false,
      }),
    },
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
export class AppModule {}
