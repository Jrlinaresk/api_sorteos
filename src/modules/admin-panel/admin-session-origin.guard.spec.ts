import { ForbiddenException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { ExecutionContext } from '@nestjs/common';
import { AdminSessionOriginGuard } from './admin-session-origin.guard';

describe('AdminSessionOriginGuard', () => {
  function guard(origins = '', nodeEnvironment = 'test') {
    const config = {
      get: jest.fn((name: string) => {
        if (name === 'ADMIN_PANEL_ORIGINS') return origins;
        if (name === 'NODE_ENV') return nodeEnvironment;
        return undefined;
      }),
    } as unknown as ConfigService;
    return new AdminSessionOriginGuard(config);
  }

  function context(headers: Record<string, string>) {
    const normalized = Object.fromEntries(
      Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value]),
    );
    const request = {
      protocol: 'https',
      header: (name: string) => normalized[name.toLowerCase()],
      get: (name: string) =>
        name.toLowerCase() === 'host'
          ? normalized.host || 'admin.example.com'
          : normalized[name.toLowerCase()],
    };
    return {
      switchToHttp: () => ({ getRequest: () => request }),
    } as unknown as ExecutionContext;
  }

  it('acepta el panel servido en el mismo origen', () => {
    expect(
      guard().canActivate(
        context({
          origin: 'https://admin.example.com',
          host: 'admin.example.com',
          'x-admin-session': 'browser',
          'sec-fetch-site': 'same-origin',
        }),
      ),
    ).toBe(true);
  });

  it('rechaza un portal cliente incluido en el CORS global', () => {
    expect(() =>
      guard().canActivate(
        context({
          origin: 'https://clientes.example.com',
          host: 'api.example.com',
          'x-admin-session': 'browser',
          'sec-fetch-site': 'same-site',
        }),
      ),
    ).toThrow(ForbiddenException);
  });

  it('nunca confía en Host como origen administrativo en producción', () => {
    expect(() =>
      guard('https://admin.example.com', 'production').canActivate(
        context({
          origin: 'https://clientes.example.com',
          host: 'clientes.example.com',
          'x-admin-session': 'browser',
          'sec-fetch-site': 'same-origin',
        }),
      ),
    ).toThrow(ForbiddenException);
  });

  it('admite únicamente orígenes administrativos configurados de forma explícita', () => {
    expect(
      guard('https://admin-ui.example.com').canActivate(
        context({
          origin: 'https://admin-ui.example.com',
          host: 'api.example.com',
          'x-admin-session': 'browser',
          'sec-fetch-site': 'cross-site',
        }),
      ),
    ).toBe(true);
  });

  it('exige la cabecera no simple incluso sin Origin', () => {
    expect(() => guard().canActivate(context({}))).toThrow(
      'Cabecera de sesión administrativa inválida',
    );
  });

  it('rechaza una navegación cruzada que omite Origin', () => {
    expect(() =>
      guard().canActivate(
        context({
          'x-admin-session': 'browser',
          'sec-fetch-site': 'same-site',
        }),
      ),
    ).toThrow('Origen administrativo no permitido');
  });
});
