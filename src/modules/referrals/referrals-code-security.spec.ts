import { BadRequestException } from '@nestjs/common';
import { ROLES_KEY } from '../auth/decorators/roles.decorator';
import { UserRole } from '../users/enums/user-role.enum';
import { ReferralsAdminController } from './referrals-admin.controller';
import { ReferralsService } from './referrals.service';

describe('Referral code financial security', () => {
  const beneficiaryUserId = '507f1f77bcf86cd799439011';
  const campaignId = '507f1f77bcf86cd799439012';
  let codeModel: { create: jest.Mock };
  let users: { findOneOrNull: jest.Mock };
  let campaigns: { findOne: jest.Mock };
  let service: ReferralsService;

  beforeEach(() => {
    codeModel = {
      create: jest.fn(async (payload) => ({ _id: 'code-id', ...payload })),
    };
    users = {
      findOneOrNull: jest.fn().mockResolvedValue({
        _id: beneficiaryUserId,
        isActive: true,
      }),
    };
    campaigns = {
      findOne: jest.fn().mockResolvedValue({ _id: campaignId }),
    };
    service = new ReferralsService(
      codeModel as never,
      {} as never,
      {} as never,
      undefined,
      users as never,
      campaigns as never,
    );
  });

  it('exige beneficiario para cualquier comisión positiva', async () => {
    await expect(
      service.createCode({ commissionRateBps: 500 }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(codeModel.create).not.toHaveBeenCalled();
  });

  it('rechaza beneficiarios inexistentes o inactivos', async () => {
    users.findOneOrNull.mockResolvedValue({ isActive: false });

    await expect(
      service.createCode({ beneficiaryUserId, commissionRateBps: 500 }),
    ).rejects.toThrow('Beneficiario inexistente o inactivo');
    expect(codeModel.create).not.toHaveBeenCalled();
  });

  it('valida beneficiario activo y campaña real antes de persistir', async () => {
    await service.createCode({
      code: 'SOCIO1',
      beneficiaryUserId,
      commissionRateBps: 500,
      campaignId,
    });

    expect(users.findOneOrNull).toHaveBeenCalledWith(beneficiaryUserId);
    expect(campaigns.findOne).toHaveBeenCalledWith(campaignId);
    expect(codeModel.create).toHaveBeenCalledWith(
      expect.objectContaining({
        code: 'SOCIO1',
        beneficiaryUser: expect.any(Object),
        campaignId,
        commissionRateBps: 500,
      }),
    );
  });

  it('reserva crear y editar términos financieros exclusivamente a ADMIN', () => {
    expect(
      Reflect.getMetadata(
        ROLES_KEY,
        ReferralsAdminController.prototype.createCode,
      ),
    ).toEqual([UserRole.ADMIN]);
    expect(
      Reflect.getMetadata(
        ROLES_KEY,
        ReferralsAdminController.prototype.updateCode,
      ),
    ).toEqual([UserRole.ADMIN]);
  });
});
