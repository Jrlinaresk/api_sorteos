import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { AdminSessionController } from './admin-session.controller';
import { UserRole } from '../users/enums/user-role.enum';

describe('AdminSessionController', () => {
  const expiresAt = new Date('2026-08-25T12:00:00.000Z');
  let auth: Record<string, jest.Mock>;
  let config: { get: jest.Mock };
  let response: { cookie: jest.Mock; clearCookie: jest.Mock };
  let controller: AdminSessionController;

  const session = (role: UserRole = UserRole.OPERATOR) => ({
    accessToken: 'short-lived-access',
    refreshToken: 'long-lived-refresh',
    refreshTokenExpiresAt: expiresAt,
    tokenType: 'Bearer' as const,
    expiresIn: '15m',
    user: {
      id: '507f1f77bcf86cd799439011',
      phone: '+5511999999999',
      role,
      isActive: true,
      emailVerified: true,
      balance: 0,
    },
  });

  beforeEach(() => {
    auth = {
      login: jest.fn(),
      refresh: jest.fn(),
      logout: jest.fn().mockResolvedValue(undefined),
    };
    config = { get: jest.fn().mockReturnValue('test') };
    response = {
      cookie: jest.fn(),
      clearCookie: jest.fn(),
    };
    controller = new AdminSessionController(auth as never, config as never);
  });

  it('entrega solo el access token y conserva el refresh en cookie HttpOnly', async () => {
    auth.login.mockResolvedValue(session());

    const result = await controller.login(
      { phone: '+5511999999999', password: 'secret-password' },
      response as never,
    );
    expect(result).toEqual({
      accessToken: 'short-lived-access',
      tokenType: 'Bearer',
      expiresIn: '15m',
      user: expect.objectContaining({ role: UserRole.OPERATOR }),
    });
    expect(response.cookie).toHaveBeenCalledWith(
      'sorteos_admin_refresh',
      'long-lived-refresh',
      expect.objectContaining({
        httpOnly: true,
        secure: false,
        sameSite: 'strict',
        path: '/api/v1/admin/session',
        expires: expiresAt,
        priority: 'high',
      }),
    );
    expect(result).not.toHaveProperty('refreshToken');
  });

  it('revoca una sesión autenticada que no pertenece al equipo', async () => {
    const customerSession = session(UserRole.CUSTOMER);
    auth.login.mockResolvedValue(customerSession);

    await expect(
      controller.login(
        { phone: '+5511999999999', password: 'secret-password' },
        response as never,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(auth.logout).toHaveBeenCalledWith(customerSession.refreshToken);
    expect(response.cookie).not.toHaveBeenCalled();
  });

  it('rota el refresh leído de una cookie codificada', async () => {
    const rotated = {
      ...session(UserRole.ADMIN),
      refreshToken: 'rotated/token',
    };
    auth.refresh.mockResolvedValue(rotated);

    await expect(
      controller.refresh(
        {
          headers: {
            cookie:
              'other=value; sorteos_admin_refresh=presented%2Ftoken; theme=dark',
          },
        } as never,
        response as never,
      ),
    ).resolves.toEqual(
      expect.objectContaining({
        accessToken: 'short-lived-access',
        user: expect.objectContaining({ role: UserRole.ADMIN }),
      }),
    );
    expect(auth.refresh).toHaveBeenCalledWith('presented/token');
    expect(response.cookie).toHaveBeenCalledWith(
      'sorteos_admin_refresh',
      'rotated/token',
      expect.any(Object),
    );
  });

  it('rechaza refresh sin cookie administrativa', async () => {
    await expect(
      controller.refresh({ headers: {} } as never, response as never),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(auth.refresh).not.toHaveBeenCalled();
  });

  it('revoca y limpia la cookie al cerrar sesión', async () => {
    await controller.logout(
      { headers: { cookie: 'sorteos_admin_refresh=current' } } as never,
      response as never,
    );

    expect(auth.logout).toHaveBeenCalledWith('current');
    expect(response.clearCookie).toHaveBeenCalledWith(
      'sorteos_admin_refresh',
      expect.objectContaining({
        httpOnly: true,
        sameSite: 'strict',
        path: '/api/v1/admin/session',
      }),
    );
  });

  it('conserva la cookie y propaga el error si no pudo revocar la sesión', async () => {
    auth.logout.mockRejectedValueOnce(new Error('mongo unavailable'));

    await expect(
      controller.logout(
        { headers: { cookie: 'sorteos_admin_refresh=current' } } as never,
        response as never,
      ),
    ).rejects.toThrow('mongo unavailable');
    expect(response.clearCookie).not.toHaveBeenCalled();
  });

  it('marca la cookie como Secure en producción', async () => {
    config.get.mockReturnValue('production');
    auth.login.mockResolvedValue(session(UserRole.ADMIN));

    await controller.login(
      { phone: '+5511999999999', password: 'secret-password' },
      response as never,
    );

    expect(response.cookie).toHaveBeenCalledWith(
      'sorteos_admin_refresh',
      expect.any(String),
      expect.objectContaining({ secure: true }),
    );
  });
});
