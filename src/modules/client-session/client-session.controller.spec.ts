import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import { UserRole } from '../users/enums/user-role.enum';
import {
  ClientSessionCsrfGuard,
  CLIENT_SESSION_HEADER,
} from './client-session-csrf.guard';
import { ClientSessionController } from './client-session.controller';

describe('ClientSessionController', () => {
  const expiresAt = new Date('2026-09-24T12:00:00.000Z');
  const customer = {
    id: '507f1f77bcf86cd799439011',
    phone: '+5511999999999',
    nickname: 'joao',
    role: UserRole.CUSTOMER,
    isActive: true,
    emailVerified: true,
    balance: 0,
    participations: [],
  };
  const session = (role: UserRole = UserRole.CUSTOMER) => ({
    accessToken: 'short-lived-access',
    refreshToken: 'long-lived-refresh',
    refreshTokenExpiresAt: expiresAt,
    tokenType: 'Bearer' as const,
    expiresIn: '15m',
    user: { ...customer, role },
  });

  let auth: Record<string, jest.Mock>;
  let config: { get: jest.Mock };
  let response: { cookie: jest.Mock; clearCookie: jest.Mock };
  let controller: ClientSessionController;

  beforeEach(() => {
    auth = {
      register: jest.fn(),
      resendRegistrationCode: jest.fn(),
      confirmRegistration: jest.fn(),
      login: jest.fn(),
      refresh: jest.fn(),
      logout: jest.fn().mockResolvedValue(undefined),
      requestPasswordReset: jest.fn(),
      confirmPasswordReset: jest.fn(),
      changePassword: jest.fn(),
    };
    config = {
      get: jest.fn((name: string) =>
        name === 'NODE_ENV' ? 'test' : undefined,
      ),
    };
    response = { cookie: jest.fn(), clearCookie: jest.fn() };
    controller = new ClientSessionController(auth as never, config as never);
  });

  it('entrega solo access token y guarda el refresh en cookie HttpOnly', async () => {
    auth.login.mockResolvedValue(session());

    const result = await controller.login(
      { phone: '+5511999999999', password: 'UnaClave9Segura' },
      response as never,
    );

    expect(auth.login).toHaveBeenCalledWith(
      expect.any(Object),
      UserRole.CUSTOMER,
    );
    expect(result).toEqual({
      accessToken: 'short-lived-access',
      tokenType: 'Bearer',
      expiresIn: '15m',
      user: customer,
    });
    expect(result).not.toHaveProperty('refreshToken');
    expect(response.cookie).toHaveBeenCalledWith(
      'sorteos_client_refresh',
      'long-lived-refresh',
      expect.objectContaining({
        httpOnly: true,
        secure: false,
        sameSite: 'lax',
        path: '/api/v1/client/session',
        priority: 'high',
        expires: expiresAt,
      }),
    );
  });

  it('rechaza y revoca defensivamente cualquier rol privilegiado', async () => {
    auth.login.mockResolvedValue(session(UserRole.ADMIN));

    await expect(
      controller.login(
        { phone: '+5511999999999', password: 'UnaClave9Segura' },
        response as never,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(auth.logout).toHaveBeenCalledWith('long-lived-refresh');
    expect(response.cookie).not.toHaveBeenCalled();
  });

  it('rota la cookie codificada y exige CUSTOMER al servicio', async () => {
    auth.refresh.mockResolvedValue({
      ...session(),
      refreshToken: 'rotated/token',
    });

    const result = await controller.refresh(
      {
        headers: {
          cookie:
            'theme=dark; sorteos_client_refresh=presented%2Ftoken; other=x',
        },
      } as never,
      response as never,
    );

    expect(auth.refresh).toHaveBeenCalledWith(
      'presented/token',
      UserRole.CUSTOMER,
    );
    expect(result).not.toHaveProperty('refreshToken');
    expect(response.cookie).toHaveBeenCalledWith(
      'sorteos_client_refresh',
      'rotated/token',
      expect.any(Object),
    );
  });

  it('rechaza refresh ausente y limpia la cookie al cerrar sesión', async () => {
    await expect(
      controller.refresh({ headers: {} } as never, response as never),
    ).rejects.toBeInstanceOf(UnauthorizedException);

    await controller.logout(
      { headers: { cookie: 'sorteos_client_refresh=current' } } as never,
      response as never,
    );
    expect(auth.logout).toHaveBeenCalledWith('current');
    expect(response.clearCookie).toHaveBeenCalledWith(
      'sorteos_client_refresh',
      expect.objectContaining({
        httpOnly: true,
        path: '/api/v1/client/session',
      }),
    );
  });

  it('no anuncia ni limpia un cierre cuya revocación no pudo persistirse', async () => {
    auth.logout.mockRejectedValueOnce(new Error('mongo unavailable'));

    await expect(
      controller.logout(
        { headers: { cookie: 'sorteos_client_refresh=current' } } as never,
        response as never,
      ),
    ).rejects.toThrow('mongo unavailable');
    expect(response.clearCookie).not.toHaveBeenCalled();
  });

  it('adopta en cookie las sesiones de alta, reset y cambio de contraseña', async () => {
    auth.confirmRegistration.mockResolvedValue(session());
    auth.confirmPasswordReset.mockResolvedValue(session());
    auth.changePassword.mockResolvedValue(session());

    await controller.confirmRegistration({} as never, response as never);
    await controller.confirmPasswordReset({} as never, response as never);
    await controller.changePassword(
      customer,
      {
        currentPassword: 'UnaClave9Segura',
        newPassword: 'OtraClave8Segura',
      },
      response as never,
    );

    expect(auth.confirmPasswordReset).toHaveBeenCalledWith(
      expect.any(Object),
      UserRole.CUSTOMER,
    );
    expect(auth.changePassword).toHaveBeenCalledWith(
      customer.id,
      'UnaClave9Segura',
      'OtraClave8Segura',
      UserRole.CUSTOMER,
    );
    expect(response.cookie).toHaveBeenCalledTimes(3);
  });

  it('usa Secure en producción y también cuando SameSite=None', async () => {
    auth.login.mockResolvedValue(session());
    config.get.mockImplementation((name: string) =>
      name === 'NODE_ENV' ? 'production' : 'strict',
    );
    await controller.login({} as never, response as never);
    expect(response.cookie).toHaveBeenLastCalledWith(
      expect.any(String),
      expect.any(String),
      expect.objectContaining({ secure: true, sameSite: 'strict' }),
    );

    config.get.mockImplementation((name: string) =>
      name === 'CLIENT_SESSION_COOKIE_SAME_SITE' ? 'none' : 'test',
    );
    await controller.login({} as never, response as never);
    expect(response.cookie).toHaveBeenLastCalledWith(
      expect.any(String),
      expect.any(String),
      expect.objectContaining({ secure: true, sameSite: 'none' }),
    );
  });
});

describe('ClientSessionCsrfGuard', () => {
  const context = (method: string, header?: string): ExecutionContext =>
    ({
      switchToHttp: () => ({
        getRequest: () => ({
          method,
          headers: header ? { [CLIENT_SESSION_HEADER]: header } : {},
        }),
      }),
    }) as never;

  it('permite lecturas y exige la cabecera no-simple en mutaciones', () => {
    const guard = new ClientSessionCsrfGuard();
    expect(guard.canActivate(context('GET'))).toBe(true);
    expect(guard.canActivate(context('POST', 'browser'))).toBe(true);
    expect(() => guard.canActivate(context('POST'))).toThrow(
      ForbiddenException,
    );
  });
});
