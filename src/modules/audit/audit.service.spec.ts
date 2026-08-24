import { AuditService } from './audit.service';
import { AuditCategory } from './enums/audit-category.enum';
import { Logger } from '@nestjs/common';

describe('AuditService', () => {
  const auditLogModel = { create: jest.fn() };
  const service = new AuditService(auditLogModel as never);
  let loggerSpy: jest.SpyInstance;

  beforeAll(() => {
    loggerSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation();
  });
  afterAll(() => loggerSpy.mockRestore());
  beforeEach(() => jest.clearAllMocks());

  it('genera correlación y resume secretos antes de persistir', async () => {
    auditLogModel.create.mockImplementation(async (value) => value);

    await service.record({
      action: ' settings.update ',
      category: AuditCategory.ADMINISTRATION,
      actorId: '507f1f77bcf86cd799439011',
      before: { password: 'old', theme: { primaryColor: '#000000' } },
      after: { accessToken: 'jwt', theme: { primaryColor: '#FFFFFF' } },
    });

    expect(auditLogModel.create).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'settings.update',
        correlationId: expect.stringMatching(
          /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
        ),
        before: {
          password: '[REDACTED]',
          theme: { primaryColor: '#000000' },
        },
        after: {
          accessToken: '[REDACTED]',
          theme: { primaryColor: '#FFFFFF' },
        },
        expiresAt: expect.any(Date),
      }),
    );
  });

  it('tryRecord no interrumpe la operación auditada si Mongo falla', async () => {
    auditLogModel.create.mockRejectedValueOnce(new Error('db unavailable'));
    await expect(
      service.tryRecord({ action: 'security.login.failure' }),
    ).resolves.toBeUndefined();
  });
});
