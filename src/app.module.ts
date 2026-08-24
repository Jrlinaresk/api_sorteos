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
      useFactory: (config: ConfigService) => ({
        uri: mongoUri(config),
        maxPoolSize: Number(config.get<string>('MONGODB_MAX_POOL_SIZE') || 20),
        serverSelectionTimeoutMS: 10_000,
        autoIndex: config.get<string>('MONGODB_AUTO_INDEX') !== 'false',
      }),
    }),
    ScheduleModule.forRoot(),
    ThrottlerModule.forRoot([
      {
        ttl: Number(process.env.RATE_LIMIT_WINDOW_MS || 60_000),
        limit: Number(process.env.RATE_LIMIT_MAX || 180),
      },
    ]),
    HealthModule,
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

function mongoUri(config: ConfigService): string {
  const configured = config.get<string>('MONGODB_URI')?.trim();
  if (configured) return configured;

  const host = config.get<string>('DB_HOST') || '127.0.0.1';
  const port = config.get<string>('DB_PORT') || '27017';
  const database = config.get<string>('DB_NAME') || 'api_sorteos';
  const user = config.get<string>('DB_USER');
  const password = config.get<string>('DB_PASSWORD');
  const credentials = user
    ? `${encodeURIComponent(user)}:${encodeURIComponent(password || '')}@`
    : '';
  const query = new URLSearchParams();
  if (user) query.set('authSource', config.get<string>('DB_AUTH_SOURCE') || 'admin');
  const replicaSet = config.get<string>('MONGODB_REPLICA_SET');
  if (replicaSet) {
    query.set('replicaSet', replicaSet);
    query.set('retryWrites', 'true');
    query.set('w', 'majority');
  }
  const suffix = query.size ? `?${query.toString()}` : '';
  return `mongodb://${credentials}${host}:${port}/${database}${suffix}`;
}
