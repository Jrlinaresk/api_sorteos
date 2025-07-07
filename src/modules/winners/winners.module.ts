/* src/modules/winners/winners.module.ts */
import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { WinnersService } from './winners.service';
import { WinnersController } from './winners.controller';
import { Raffle, RaffleSchema } from '../riffles/schema/raffle.schema';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: Raffle.name, schema: RaffleSchema }]),
  ],
  providers: [WinnersService],
  controllers: [WinnersController],
  exports: [WinnersService],
})
export class WinnersModule {}
