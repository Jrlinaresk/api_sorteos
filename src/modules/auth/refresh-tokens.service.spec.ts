import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomUUID } from 'crypto';
import { Types } from 'mongoose';
import { RefreshTokensService } from './refresh-tokens.service';

function queryResult<T>(value: T) {
  return { exec: jest.fn().mockResolvedValue(value) };
}

describe('RefreshTokensService rotation and reuse detection', () => {
  const now = new Date('2026-08-24T12:00:00.000Z');
  let sessions: Record<string, jest.Mock>;
  let config: Record<string, jest.Mock>;
  let service: RefreshTokensService;

  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(now);
    sessions = {
      create: jest.fn().mockResolvedValue(undefined),
      findOne: jest.fn(),
      findOneAndUpdate: jest.fn(),
      exists: jest.fn().mockReturnValue(queryResult(null)),
      updateOne: jest.fn().mockResolvedValue({ modifiedCount: 1 }),
      updateMany: jest.fn().mockResolvedValue({ modifiedCount: 1 }),
    };
    config = {
      get: jest.fn((key: string) =>
        key === 'JWT_REFRESH_DAYS' ? '30' : undefined,
      ),
    };
    service = new RefreshTokensService(
      sessions as any,
      config as unknown as ConfigService,
    );
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('emite alta entropía, almacena solo SHA-256 y fija caducidad', async () => {
    const userId = new Types.ObjectId().toString();
    const familyId = randomUUID();
    const issued = await service.issue(userId, familyId, 7);

    expect(issued.token).toMatch(/^[A-Za-z0-9_-]{64}$/);
    expect(issued.expiresAt).toEqual(new Date(now.getTime() + 30 * 86_400_000));
    expect(sessions.create).toHaveBeenCalledWith({
      user: new Types.ObjectId(userId),
      familyId,
      authVersion: 7,
      tokenHash: createHash('sha256').update(issued.token).digest('hex'),
      expiresAt: issued.expiresAt,
    });
    expect(issued.authVersion).toBe(7);
    expect(sessions.create.mock.calls[0][0].tokenHash).not.toBe(issued.token);
  });

  it('rota con compare-and-set, revoca el anterior y conserva familia/usuario', async () => {
    const user = new Types.ObjectId();
    const oldToken = 'old-refresh-token';
    const session = {
      _id: new Types.ObjectId(),
      user,
      familyId: 'family-rotation',
      authVersion: 4,
      expiresAt: new Date(now.getTime() + 86_400_000),
    };
    sessions.findOne.mockReturnValue(queryResult(session));
    sessions.findOneAndUpdate.mockResolvedValue({ ...session, revokedAt: now });

    const rotated = await service.rotate(oldToken);
    const newHash = createHash('sha256').update(rotated.token).digest('hex');

    expect(sessions.findOne).toHaveBeenCalledWith({
      tokenHash: createHash('sha256').update(oldToken).digest('hex'),
    });
    expect(sessions.findOneAndUpdate).toHaveBeenCalledWith(
      { _id: session._id, revokedAt: { $exists: false } },
      {
        $set: expect.objectContaining({
          revokedAt: now,
          revokeReason: 'Rotado',
          replacedByTokenHash: newHash,
        }),
      },
      { new: true },
    );
    expect(sessions.create).toHaveBeenCalledWith({
      user,
      familyId: 'family-rotation',
      authVersion: 4,
      tokenHash: newHash,
      expiresAt: new Date(now.getTime() + 30 * 86_400_000),
    });
    expect(rotated.userId).toBe(user.toString());
    expect(rotated.authVersion).toBe(4);
  });

  it('detecta reutilización de un token revocado y revoca toda la familia', async () => {
    const oldToken = 'reused-refresh-token';
    sessions.findOne.mockReturnValue(
      queryResult({
        _id: new Types.ObjectId(),
        user: new Types.ObjectId(),
        familyId: 'compromised-family',
        expiresAt: new Date(now.getTime() + 86_400_000),
        revokedAt: new Date(now.getTime() - 1_000),
      }),
    );

    await expect(service.rotate(oldToken)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(sessions.updateMany).toHaveBeenCalledWith(
      { familyId: 'compromised-family' },
      {
        $set: {
          revokedAt: now,
          revokeReason: 'Reutilización de refresh token detectada',
          familyCompromisedAt: now,
          familyCompromiseReason: 'Reutilización de refresh token detectada',
        },
      },
    );
    expect(sessions.findOneAndUpdate).not.toHaveBeenCalled();
    expect(sessions.create).not.toHaveBeenCalled();
  });

  it('detecta dos rotaciones paralelas y revoca la familia perdedora', async () => {
    const current = {
      _id: new Types.ObjectId(),
      user: new Types.ObjectId(),
      familyId: 'parallel-family',
      expiresAt: new Date(now.getTime() + 86_400_000),
    };
    sessions.findOne.mockReturnValue(queryResult(current));
    sessions.findOneAndUpdate.mockResolvedValue(null);

    await expect(service.rotate('parallel-token')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(sessions.updateMany).toHaveBeenCalledWith(
      { familyId: 'parallel-family' },
      {
        $set: {
          revokedAt: now,
          revokeReason: 'Refresh token usado en paralelo',
          familyCompromisedAt: now,
          familyCompromiseReason: 'Refresh token usado en paralelo',
        },
      },
    );
    expect(sessions.create).not.toHaveBeenCalled();
  });

  it('rechaza un sucesor si la familia fue comprometida durante la rotación', async () => {
    const current = {
      _id: new Types.ObjectId(),
      user: new Types.ObjectId(),
      familyId: 'raced-family',
      expiresAt: new Date(now.getTime() + 86_400_000),
    };
    sessions.findOne.mockReturnValue(queryResult(current));
    sessions.findOneAndUpdate.mockResolvedValue({ ...current, revokedAt: now });
    sessions.exists.mockReturnValue(queryResult({ _id: current._id }));

    await expect(service.rotate('raced-token')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );

    expect(sessions.create).toHaveBeenCalledTimes(1);
    expect(sessions.updateMany).toHaveBeenCalledWith(
      { familyId: 'raced-family' },
      {
        $set: {
          revokedAt: now,
          revokeReason: 'Refresh token usado en paralelo',
          familyCompromisedAt: now,
          familyCompromiseReason: 'Refresh token usado en paralelo',
        },
      },
    );
  });

  it('rechaza directamente cualquier token de una familia ya comprometida', async () => {
    sessions.findOne.mockReturnValue(
      queryResult({
        _id: new Types.ObjectId(),
        user: new Types.ObjectId(),
        familyId: 'marked-family',
        expiresAt: new Date(now.getTime() + 86_400_000),
        familyCompromisedAt: new Date(now.getTime() - 1_000),
        familyCompromiseReason: 'Incidente previo',
      }),
    );

    await expect(service.rotate('marked-token')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(sessions.findOneAndUpdate).not.toHaveBeenCalled();
    expect(sessions.updateMany).toHaveBeenCalledWith(
      { familyId: 'marked-family' },
      {
        $set: {
          revokedAt: now,
          revokeReason: 'Incidente previo',
          familyCompromisedAt: now,
          familyCompromiseReason: 'Incidente previo',
        },
      },
    );
  });

  it('revoca y persiste un token expirado sin crear sucesor', async () => {
    const expired: Record<string, any> = {
      _id: new Types.ObjectId(),
      user: new Types.ObjectId(),
      familyId: 'expired-family',
      expiresAt: new Date(now.getTime() - 1),
      save: jest.fn().mockResolvedValue(undefined),
    };
    sessions.findOne.mockReturnValue(queryResult(expired));

    await expect(service.rotate('expired-token')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(expired.revokedAt).toEqual(now);
    expect(expired.revokeReason).toBe('Expirado');
    expect(expired.save).toHaveBeenCalledTimes(1);
    expect(sessions.create).not.toHaveBeenCalled();
  });

  it('rechaza hashes desconocidos sin revelar si existió una sesión', async () => {
    sessions.findOne.mockReturnValue(queryResult(null));
    await expect(service.rotate('unknown-token')).rejects.toMatchObject({
      message: 'Sesión de renovación inválida o vencida',
    });
    expect(sessions.updateMany).not.toHaveBeenCalled();
  });

  it('revoca token y usuario solo si siguen activos y limita el motivo', async () => {
    const longReason = 'x'.repeat(250);
    const userId = new Types.ObjectId().toString();
    await service.revoke('logout-token', longReason);
    await service.revokeAllForUser(userId, longReason);

    expect(sessions.updateOne).toHaveBeenCalledWith(
      {
        tokenHash: createHash('sha256').update('logout-token').digest('hex'),
        revokedAt: { $exists: false },
      },
      {
        $set: {
          revokedAt: now,
          revokeReason: 'x'.repeat(160),
        },
      },
    );
    expect(sessions.updateMany).toHaveBeenCalledWith(
      { user: new Types.ObjectId(userId), revokedAt: { $exists: false } },
      { $set: { revokedAt: now, revokeReason: 'x'.repeat(160) } },
    );
  });

  it.each([
    ['999', 90],
    ['0', 1],
    ['not-a-number', 30],
  ])('limita JWT_REFRESH_DAYS=%s a %s días', async (configured, days) => {
    config.get.mockReturnValue(configured);
    const issued = await service.issue(new Types.ObjectId().toString());
    expect(issued.expiresAt).toEqual(
      new Date(now.getTime() + days * 86_400_000),
    );
  });
});
