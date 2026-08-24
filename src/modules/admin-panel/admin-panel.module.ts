import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AuthModule } from '../auth/auth.module';
import { AdminSessionController } from './admin-session.controller';

@Module({
  imports: [AuthModule, ConfigModule],
  controllers: [AdminSessionController],
})
export class AdminPanelModule {}
