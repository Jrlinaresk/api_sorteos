import 'reflect-metadata';
import { AUDIT_ACTION_KEY } from '../audit/decorators/audit-action.decorator';
import { AuditCategory } from '../audit/enums/audit-category.enum';
import { ROLES_KEY } from '../auth/decorators/roles.decorator';
import { UserRole } from '../users/enums/user-role.enum';
import { RafflesController } from './raffles.controller';

describe('RafflesController lifecycle authorization', () => {
  it('reserva la prórroga a ADMIN y la marca como operación auditada', () => {
    const handler = RafflesController.prototype.extendExpired;

    expect(Reflect.getMetadata(ROLES_KEY, handler)).toEqual([UserRole.ADMIN]);
    expect(Reflect.getMetadata(AUDIT_ACTION_KEY, handler)).toEqual({
      action: 'campaign.lifecycle.extend',
      category: AuditCategory.ADMINISTRATION,
      resourceType: 'campaign',
      resourceIdParam: 'id',
      captureRequest: true,
    });
  });

  it('deriva el actor del JWT y no del body', async () => {
    const campaigns = {
      extendExpiredCampaign: jest.fn().mockResolvedValue({ status: 'active' }),
    };
    const controller = new RafflesController(campaigns as never);
    const dto = {
      closesAt: '2026-08-30T12:00:00.000Z',
      reason: 'Demanda comprobada',
    };

    await expect(
      controller.extendExpired('campaign-id', dto, {
        user: { id: 'jwt-actor' },
      } as never),
    ).resolves.toEqual({ status: 'active' });
    expect(campaigns.extendExpiredCampaign).toHaveBeenCalledWith(
      'campaign-id',
      dto,
      'jwt-actor',
    );
  });
});
