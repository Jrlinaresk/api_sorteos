import { ConflictException } from '@nestjs/common';
import { UserRole } from '../users/enums/user-role.enum';
import { SettingsVersionStatus } from './enums/settings-status.enum';
import { SettingsService } from './settings.service';
import { DEFAULT_SETTINGS } from './utils/settings-defaults';

function queryResult<T>(result: T) {
  const query = {
    lean: jest.fn(),
    sort: jest.fn(),
    skip: jest.fn(),
    limit: jest.fn(),
    session: jest.fn(),
    exec: jest.fn().mockResolvedValue(result),
  };
  query.lean.mockReturnValue(query);
  query.sort.mockReturnValue(query);
  query.skip.mockReturnValue(query);
  query.limit.mockReturnValue(query);
  query.session.mockReturnValue(query);
  return query;
}

describe('SettingsService', () => {
  const settingsModel = {
    findOne: jest.fn(),
    findOneAndUpdate: jest.fn(),
    create: jest.fn(),
  };
  const counterModel = {
    findById: jest.fn(),
    findByIdAndUpdate: jest.fn(),
  };
  const auditService = { record: jest.fn() };
  const session = {
    withTransaction: jest.fn(async (work: () => Promise<void>) => work()),
    endSession: jest.fn().mockResolvedValue(undefined),
  };
  const connection = { startSession: jest.fn().mockResolvedValue(session) };
  let service: SettingsService;
  const actor = {
    actorId: '507f1f77bcf86cd799439011',
    actorRole: UserRole.ADMIN,
    correlationId: 'request-1',
  };

  beforeEach(() => {
    jest.clearAllMocks();
    auditService.record.mockResolvedValue({});
    service = new SettingsService(
      settingsModel as never,
      counterModel as never,
      auditService as never,
      connection as never,
    );
  });

  it('devuelve una configuración pública utilizable antes de la primera publicación', async () => {
    counterModel.findById.mockReturnValue(queryResult(null));
    settingsModel.findOne.mockReturnValue(queryResult(null));

    const result = await service.getPublic();

    expect(result.version).toBe(0);
    expect(result.publishedAt).toBeNull();
    expect(result.brand).toEqual(DEFAULT_SETTINGS.brand);
    expect(result.featureFlags.notifications).toBe(true);
  });

  it('crea una versión monotónica como borrador y la audita', async () => {
    counterModel.findByIdAndUpdate.mockReturnValue(
      queryResult({ nextVersion: 3 }),
    );
    const stored = {
      _id: 'settings-id',
      version: 3,
      status: SettingsVersionStatus.DRAFT,
      brand: { siteName: 'ZERO7' },
      contact: {},
      social: {},
      theme: DEFAULT_SETTINGS.theme,
      legal: {},
      featureFlags: DEFAULT_SETTINGS.featureFlags,
      createdBy: actor.actorId,
    };
    settingsModel.create.mockResolvedValue([
      {
        toObject: () => stored,
      },
    ]);

    const result = await service.createVersion(
      { brand: { siteName: 'ZERO7' }, changeNote: 'Nueva identidad' },
      actor,
    );

    expect(result.version).toBe(3);
    expect(result.status).toBe(SettingsVersionStatus.DRAFT);
    expect(settingsModel.create).toHaveBeenCalledWith(
      [expect.objectContaining({ version: 3, createdBy: actor.actorId })],
      { session },
    );
    expect(auditService.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'settings.version.create',
        resourceId: '3',
      }),
      session,
    );
    expect(session.endSession).toHaveBeenCalled();
  });

  it('impide modificar una versión publicada', async () => {
    settingsModel.findOne.mockReturnValue(
      queryResult({ version: 2, status: SettingsVersionStatus.PUBLISHED }),
    );

    await expect(
      service.updateDraft(2, { brand: { tagline: 'Cambio' } }, actor),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(settingsModel.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it('impide archivar la versión pública vigente', async () => {
    counterModel.findById.mockReturnValue(queryResult({ publishedVersion: 2 }));
    settingsModel.findOne.mockReturnValue(
      queryResult({ version: 2, status: SettingsVersionStatus.PUBLISHED }),
    );

    await expect(service.archive(2, actor)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(settingsModel.findOneAndUpdate).not.toHaveBeenCalled();
  });
});
