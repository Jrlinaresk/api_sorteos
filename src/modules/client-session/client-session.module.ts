import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AuthModule } from '../auth/auth.module';
import { ClientSessionCsrfGuard } from './client-session-csrf.guard';
import { ClientSessionController } from './client-session.controller';

@Module({
  imports: [AuthModule, ConfigModule],
  controllers: [ClientSessionController],
  providers: [ClientSessionCsrfGuard],
})
export class ClientSessionModule {}
