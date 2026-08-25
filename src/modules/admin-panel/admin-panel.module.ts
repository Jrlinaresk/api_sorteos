import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AuthModule } from '../auth/auth.module';
import { AdminSessionController } from './admin-session.controller';
import { AdminSessionOriginGuard } from './admin-session-origin.guard';

@Module({
  imports: [AuthModule, ConfigModule],
  controllers: [AdminSessionController],
  providers: [AdminSessionOriginGuard],
})
export class AdminPanelModule {}
