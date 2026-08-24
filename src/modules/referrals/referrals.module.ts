import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AuthModule } from '../auth/auth.module';
import { UsersModule } from '../users/users.module';
import { RafflesModule } from '../riffles/riffles.module';
import { ReferralAttributionService } from './referral-attribution.service';
import { ReferralClickRateLimitGuard } from './referral-click-rate-limit.guard';
import { ReferralsAdminController } from './referrals-admin.controller';
import { ReferralsPublicController } from './referrals-public.controller';
import { ReferralsUserController } from './referrals-user.controller';
import { ReferralsService } from './referrals.service';
import {
  ReferralClick,
  ReferralClickSchema,
} from './schemas/referral-click.schema';
import {
  ReferralCode,
  ReferralCodeSchema,
} from './schemas/referral-code.schema';
import {
  ReferralCommission,
  ReferralCommissionSchema,
} from './schemas/referral-commission.schema';

@Module({
  imports: [
    AuthModule,
    UsersModule,
    RafflesModule,
    MongooseModule.forFeature([
      { name: ReferralCode.name, schema: ReferralCodeSchema },
      { name: ReferralClick.name, schema: ReferralClickSchema },
      { name: ReferralCommission.name, schema: ReferralCommissionSchema },
    ]),
  ],
  controllers: [
    ReferralsPublicController,
    ReferralsUserController,
    ReferralsAdminController,
  ],
  providers: [
    ReferralsService,
    ReferralAttributionService,
    ReferralClickRateLimitGuard,
  ],
  exports: [ReferralsService, ReferralAttributionService],
})
export class ReferralsModule {}
