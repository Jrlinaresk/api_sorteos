/* src/modules/tasks/tasks.module.ts */
import { Module } from '@nestjs/common';
import { TasksService } from './tasks.service';
import { RafflesModule } from '../riffles/riffles.module';

@Module({
  imports: [RafflesModule],
  providers: [TasksService],
})
export class TasksModule {}
