/* src/modules/raffles/raffles.module.ts */
import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { RafflesController } from './raffles.controller';
import { RafflesService } from './raffles.service';
import { Raffle, RaffleSchema } from './schema/raffle.schema';
import { CampaignsController } from './campaigns.controller';
import { AuthModule } from '../auth/auth.module';
import { MediaModule } from '../media/media.module';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: Raffle.name, schema: RaffleSchema }]),
    AuthModule,
    MediaModule,
  ],
  controllers: [RafflesController, CampaignsController],
  providers: [RafflesService],
  exports: [RafflesService, MongooseModule],
})
export class RafflesModule {}
