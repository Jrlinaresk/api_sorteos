import { Module, ValidationPipe } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { APP_PIPE } from '@nestjs/core';
import { LocationsModule } from './modules/locations/locations.module';
import { EmailModule } from './modules/email/email.module';
import { WinnersModule } from './modules/winners/winners.module';
import { RafflesModule } from './modules/riffles/riffles.module';
import { CategoriesModule } from './modules/category/categories.module';
import { UsersModule } from './modules/users/users.module';
import { TransactionsModule } from './modules/transactions/transactions.module';
import { ProductsModule } from './modules/products/products.module';
import { HealthModule } from './health/health.module';
@Module({
  imports: [
    ConfigModule.forRoot({
      envFilePath: `.env.${process.env.NODE_ENV}`,
      isGlobal: true,
    }),
    MongooseModule.forRoot(
      `mongodb://${process.env.DB_USER}:${process.env.DB_PASSWORD}@${process.env.DB_HOST}/?retryWrites=true&w=majority`,
    ),
    HealthModule,
    CategoriesModule,
    LocationsModule,
    EmailModule,
    RafflesModule,
    WinnersModule,
    UsersModule,
    ProductsModule,
    TransactionsModule,
  ],
  controllers: [],
  providers: [
    {
      provide: APP_PIPE,
      useClass: ValidationPipe,
    },
  ],
})
export class AppModule {}
