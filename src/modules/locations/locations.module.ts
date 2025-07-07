// src/modules/locations/locations.module.ts
import { Module } from '@nestjs/common';
import { LocationsService } from './locations.service';
import { LocationsController } from './locations.controller';

@Module({
  imports: [],
  providers: [LocationsService],
  controllers: [LocationsController],
})
export class LocationsModule {}
