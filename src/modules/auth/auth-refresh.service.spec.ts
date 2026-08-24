import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Types } from 'mongoose';
import { AuthService } from './auth.service';
import { RefreshTokensService } from './refresh-tokens.service';
import { UserRole } from '../users/enums/user-role.enum';

describe('AuthService refresh integration', () => {
  let users: Record<string, jest.Mock>;
  let jwt: Record<string, jest.Mock>;
  let email: Record<string, jest.Mock>;
  let refresh: Record<string, jest.Mock>;
  let service: AuthService;

  const user = () => ({
    _id: new Types.ObjectId(),
    phone: '+5511999999999',
    email: 'maria@example.com',
    role: UserRole.CUSTOMER,
    isActive: true,
  });

  beforeEach(() => {
    users = {
      findOne: jest.fn(),
      findByPhone: jest.fn(),
      setPassword: jest.fn(),
      toPublicUser: jest.fn((value) => ({
        id: value._id.toString(),
        phone: value.phone,
      })),
    };
    jwt = { signAsync: jest.fn().mockResolvedValue('new-access-token') };
    email = { verifyCode: jest.fn().mockResolvedValue(undefined) };
    refresh = {
      rotate: jest.fn(),
      issue: jest.fn(),
      revoke: jest.fn(),
      revokeAllForUser: jest.fn().mockResolvedValue(undefined),
    };
    service = new AuthService(
      users as any,
      jwt as unknown as JwtService,
      { get: jest.fn().mockReturnValue('15m') } as unknown as ConfigService,
      email as any,
      refresh as unknown as RefreshTokensService,
    );
  });

  it('usa el refresh rotado al emitir el nuevo access token sin crear otro refresh', async () => {
    const account = user();
    const expiresAt = new Date('2026-09-24T12:00:00.000Z');
    refresh.rotate.mockResolvedValue({
      token: 'rotated-refresh-token',
      userId: account._id.toString(),
      expiresAt,
    });
    users.findOne.mockResolvedValue(account);

    const result = await service.refresh('old-refresh-token');

    expect(refresh.rotate).toHaveBeenCalledWith('old-refresh-token');
    expect(users.findOne).toHaveBeenCalledWith(account._id.toString());
    expect(refresh.issue).not.toHaveBeenCalled();
    expect(result).toEqual(
      expect.objectContaining({
        accessToken: 'new-access-token',
        refreshToken: 'rotated-refresh-token',
        refreshTokenExpiresAt: expiresAt,
      }),
    );
    expect(jwt.signAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        sub: account._id.toString(),
        role: UserRole.CUSTOMER,
      }),
    );
  });

  it('no entrega sesión a una cuenta desactivada aunque el refresh fuese válido', async () => {
    const account = { ...user(), isActive: false };
    refresh.rotate.mockResolvedValue({
      token: 'rotated-refresh-token',
      userId: account._id.toString(),
      expiresAt: new Date('2026-09-24T12:00:00.000Z'),
    });
    users.findOne.mockResolvedValue(account);

    await expect(service.refresh('old-refresh-token')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(jwt.signAsync).not.toHaveBeenCalled();
  });

  it('revoca todas las sesiones previas al restablecer contraseña y emite familia nueva', async () => {
    const account = user();
    users.findByPhone.mockResolvedValue(account);
    users.setPassword.mockResolvedValue(account);
    refresh.issue.mockResolvedValue({
      token: 'fresh-family-token',
      userId: account._id.toString(),
      expiresAt: new Date('2026-09-24T12:00:00.000Z'),
    });

    const result = await service.confirmPasswordReset({
      phone: account.phone,
      email: account.email,
      code: 'a1b2c3',
      newPassword: 'NuevaClave9Segura',
    });

    expect(refresh.revokeAllForUser).toHaveBeenCalledWith(
      account._id.toString(),
      'Contraseña restablecida',
    );
    expect(refresh.issue).toHaveBeenCalledWith(account._id.toString());
    expect(refresh.revokeAllForUser.mock.invocationCallOrder[0]).toBeLessThan(
      refresh.issue.mock.invocationCallOrder[0],
    );
    expect(result.refreshToken).toBe('fresh-family-token');
  });

  it('delegar logout revoca exactamente el refresh presentado', async () => {
    await service.logout('current-refresh-token');
    expect(refresh.revoke).toHaveBeenCalledWith('current-refresh-token');
  });
});
