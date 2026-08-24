import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AuditModule } from '../audit/audit.module';
import {
  SettingsCounter,
  SettingsCounterSchema,
  SiteSettings,
  SiteSettingsSchema,
} from './schemas/site-settings.schema';
import { SettingsAdminController } from './settings-admin.controller';
import { SettingsPublicController } from './settings-public.controller';
import { SettingsService } from './settings.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: SiteSettings.name, schema: SiteSettingsSchema },
      { name: SettingsCounter.name, schema: SettingsCounterSchema },
    ]),
    AuditModule,
  ],
  controllers: [SettingsPublicController, SettingsAdminController],
  providers: [SettingsService, JwtAuthGuard, RolesGuard],
  exports: [SettingsService],
})
export class SettingsModule {}
