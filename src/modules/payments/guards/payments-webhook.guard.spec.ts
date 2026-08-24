import { UnauthorizedException } from '@nestjs/common';
import { PaymentsWebhookGuard } from './payments-webhook.guard';

function context(headers: Record<string, string> = {}, query = {}) {
  const request = {
    query,
    header: jest.fn((name: string) => headers[name.toLowerCase()]),
  };
  return {
    switchToHttp: () => ({ getRequest: () => request }),
  } as never;
}

function guard(values: Record<string, string | undefined>) {
  return new PaymentsWebhookGuard({
    get: jest.fn((name: string) => values[name]),
  } as never);
}

describe('PaymentsWebhookGuard', () => {
  it('acepta el secreto solo en cabecera y rechaza una copia en la URL', () => {
    const instance = guard({
      NODE_ENV: 'production',
      EFI_WEBHOOK_HMAC: 'header-only-secret',
    });

    expect(() =>
      instance.canActivate(context({}, { hmac: 'header-only-secret' })),
    ).toThrow(UnauthorizedException);
    expect(
      instance.canActivate(
        context({ 'x-efi-webhook-token': 'header-only-secret' }),
      ),
    ).toBe(true);
  });

  it('exige configuración segura en producción y valida mTLS si está activo', () => {
    expect(() =>
      guard({ NODE_ENV: 'production' }).canActivate(context()),
    ).toThrow(UnauthorizedException);

    const mtls = guard({
      NODE_ENV: 'production',
      EFI_WEBHOOK_REQUIRE_MTLS: 'true',
      EFI_WEBHOOK_MTLS_HEADER: 'x-client-verified',
      EFI_WEBHOOK_MTLS_SUCCESS_VALUE: 'OK',
    });
    expect(() => mtls.canActivate(context())).toThrow(UnauthorizedException);
    expect(mtls.canActivate(context({ 'x-client-verified': 'OK' }))).toBe(true);
  });

  it('no permite que un HMAC sustituya mTLS con Efí en producción', () => {
    const instance = guard({
      NODE_ENV: 'production',
      PAYMENTS_PROVIDER: 'efi',
      EFI_WEBHOOK_HMAC: 'header-only-secret-long-enough',
      EFI_WEBHOOK_REQUIRE_MTLS: 'false',
    });

    expect(() =>
      instance.canActivate(
        context({
          'x-efi-webhook-token': 'header-only-secret-long-enough',
        }),
      ),
    ).toThrow(UnauthorizedException);
  });
});
