import { GUARDS_METADATA } from '@nestjs/common/constants';
import { ROLES_KEY } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { PublicUserDto } from '../users/dto/public-user.dto';
import { UserRole } from '../users/enums/user-role.enum';
import { ReferralClickRateLimitGuard } from './referral-click-rate-limit.guard';
import { ReferralsAdminController } from './referrals-admin.controller';
import { ReferralsPublicController } from './referrals-public.controller';
import { ReferralsUserController } from './referrals-user.controller';
import { ReferralsService } from './referrals.service';

describe('Referrals authorization and ownership', () => {
  it('protects user routes and scopes them to CurrentUser', () => {
    expect(
      Reflect.getMetadata(GUARDS_METADATA, ReferralsUserController),
    ).toEqual([JwtAuthGuard]);

    const service = {
      userSummary: jest.fn(),
      listUserCommissions: jest.fn(),
    } as unknown as ReferralsService;
    const controller = new ReferralsUserController(service);
    const user = { id: 'jwt-user-id' } as PublicUserDto;
    const query = { orderId: 'own-order-id' };

    controller.summary(user);
    controller.commissions(user, query);

    expect(service.userSummary).toHaveBeenCalledWith(user.id);
    expect(service.listUserCommissions).toHaveBeenCalledWith(user.id, query);
  });

  it('protects admin routes and reserves commission transitions for admins', () => {
    expect(
      Reflect.getMetadata(GUARDS_METADATA, ReferralsAdminController),
    ).toEqual([JwtAuthGuard, RolesGuard]);
    expect(Reflect.getMetadata(ROLES_KEY, ReferralsAdminController)).toEqual([
      UserRole.OPERATOR,
      UserRole.ADMIN,
    ]);
    expect(
      Reflect.getMetadata(
        ROLES_KEY,
        ReferralsAdminController.prototype.updateCommissionStatus,
      ),
    ).toEqual([UserRole.ADMIN]);
  });

  it('rate-limits only the public click endpoint', () => {
    expect(
      Reflect.getMetadata(
        GUARDS_METADATA,
        ReferralsPublicController.prototype.captureClick,
      ),
    ).toEqual([ReferralClickRateLimitGuard]);
    expect(
      Reflect.getMetadata(
        GUARDS_METADATA,
        ReferralsPublicController.prototype.resolve,
      ),
    ).toBeUndefined();
  });
});
