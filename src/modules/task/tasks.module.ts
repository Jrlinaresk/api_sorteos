/* src/modules/tasks/tasks.module.ts */
import { Module } from '@nestjs/common';
import { TasksService } from './tasks.service';
import { WinnersModule } from '../winners/winners.module';
import { RafflesModule } from '../riffles/riffles.module';
import { ScheduleModule } from '@nestjs/schedule';

@Module({
  imports: [ScheduleModule.forRoot(), RafflesModule, WinnersModule],
  providers: [TasksService],
})
export class TasksModule {}
