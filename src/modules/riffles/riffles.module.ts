/* src/modules/raffles/raffles.module.ts */
import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { RafflesController } from './raffles.controller';
import { RafflesService } from './raffles.service';
import { Raffle, RaffleSchema } from './schema/raffle.schema';
import { WinnersModule } from '../winners/winners.module';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: Raffle.name, schema: RaffleSchema }]),
    WinnersModule,
  ],
  controllers: [RafflesController],
  providers: [RafflesService],
  exports: [RafflesService],
})
export class RafflesModule {}
