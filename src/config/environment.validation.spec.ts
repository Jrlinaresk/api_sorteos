import { validateEnvironment } from './environment.validation';

describe('validateEnvironment', () => {
  const productionEnvironment = () => ({
    NODE_ENV: 'production',
    JWT_SECRET: 'j'.repeat(32),
    EMAIL_CODE_SECRET: 'e'.repeat(32),
    PAYMENTS_PUBLIC_SECRET_KEY: 'p'.repeat(32),
    CHECKOUT_ACCESS_SECRET_KEY: 'c'.repeat(32),
    ORDER_ACCESS_CODE_SECRET: 'o'.repeat(32),
    ORDER_ACCESS_MAX_ORDERS: '20',
    ORDER_ACCESS_REQUEST_COOLDOWN_SECONDS: '60',
    REFERRAL_IP_HASH_SECRET: 'r'.repeat(32),
    CORS_ORIGINS: 'https://rifa.example.com,https://admin.example.com',
    MONGODB_URI:
      'mongodb://mongo:27017/api_sorteos?replicaSet=rs0&authSource=admin',
    SMTP_HOST: 'smtp.example.com',
    SMTP_PORT: '587',
    SMTP_FROM: 'Sorteos <no-reply@example.com>',
    SMTP_USER: 'smtp-user',
    SMTP_PASS: 'smtp-password',
    MEDIA_LOCAL_ROOT: '/var/lib/api-sorteos/media',
    PAYMENTS_PROVIDER: 'efi',
    EFI_PIX_CLIENT_ID: 'client-id',
    EFI_PIX_CLIENT_SECRET: 'client-secret',
    EFI_PIX_KEY: 'pix-key',
    EFI_PIX_CERTIFICATE_PATH: __filename,
    EFI_WEBHOOK_HMAC: 'h'.repeat(24),
    CAIXA_FEDERAL_API_BASE_URL:
      'https://servicebus3.caixa.gov.br/portaldeloterias/api/federal',
    CAIXA_FEDERAL_CONFIRMATION_DELAY_MS: '250',
    DRAW_ENTROPY_BEACON_URL: 'https://beacon.nist.gov/beacon/2.0/pulse/last',
  });

  it('permite configuración mínima fuera de producción', () => {
    expect(validateEnvironment({ NODE_ENV: 'test' })).toEqual({
      NODE_ENV: 'test',
    });
  });

  it('valida el selector y el límite de suscripciones push en todos los entornos', () => {
    expect(() =>
      validateEnvironment({
        NODE_ENV: 'test',
        NOTIFICATION_PUSH_PROVIDER: 'automatic',
      }),
    ).toThrow('NOTIFICATION_PUSH_PROVIDER debe ser noop o webpush');
    expect(() =>
      validateEnvironment({
        NODE_ENV: 'test',
        WEB_PUSH_MAX_SUBSCRIPTIONS_PER_USER: '51',
      }),
    ).toThrow('WEB_PUSH_MAX_SUBSCRIPTIONS_PER_USER');
  });

  it('exige las tres variables VAPID al seleccionar webpush', () => {
    expect(() =>
      validateEnvironment({
        NODE_ENV: 'test',
        NOTIFICATION_PUSH_PROVIDER: 'webpush',
      }),
    ).toThrow('WEB_PUSH_VAPID_SUBJECT');
  });

  it('valida cuotas y retención física del almacenamiento de medios', () => {
    expect(() =>
      validateEnvironment({
        NODE_ENV: 'test',
        MEDIA_MAX_TOTAL_STORED_BYTES: '10995116277761',
      }),
    ).toThrow('MEDIA_MAX_TOTAL_STORED_BYTES');
    expect(() =>
      validateEnvironment({
        NODE_ENV: 'test',
        MEDIA_MAX_STORED_BYTES_PER_USER: '0',
      }),
    ).toThrow('MEDIA_MAX_STORED_BYTES_PER_USER');
    expect(() =>
      validateEnvironment({
        NODE_ENV: 'test',
        MEDIA_DELETED_RETENTION_DAYS: '3651',
      }),
    ).toThrow('MEDIA_DELETED_RETENTION_DAYS');
  });

  it('acota la retención de auditoría entre 1 y 3650 días', () => {
    expect(() =>
      validateEnvironment({ NODE_ENV: 'test', AUDIT_RETENTION_DAYS: '0' }),
    ).toThrow('AUDIT_RETENTION_DAYS');
    expect(
      validateEnvironment({ NODE_ENV: 'test', AUDIT_RETENTION_DAYS: '365' }),
    ).toEqual({ NODE_ENV: 'test', AUDIT_RETENTION_DAYS: '365' });
  });

  it('acepta una configuración de producción transaccional y completa', () => {
    const environment = productionEnvironment();
    expect(validateEnvironment(environment)).toEqual(environment);
  });

  it('rechaza secretos débiles antes de arrancar', () => {
    const environment = productionEnvironment();
    environment.JWT_SECRET = 'short';
    expect(() => validateEnvironment(environment)).toThrow(
      'JWT_SECRET debe tener al menos 32 caracteres',
    );
  });

  it('valida el secreto y los límites de recuperación de pedidos', () => {
    const weakSecret = productionEnvironment();
    weakSecret.ORDER_ACCESS_CODE_SECRET = 'short';
    expect(() => validateEnvironment(weakSecret)).toThrow(
      'ORDER_ACCESS_CODE_SECRET',
    );

    const excessiveLimit = productionEnvironment();
    excessiveLimit.ORDER_ACCESS_MAX_ORDERS = '51';
    expect(() => validateEnvironment(excessiveLimit)).toThrow(
      'ORDER_ACCESS_MAX_ORDERS',
    );

    const weakCooldown = productionEnvironment();
    weakCooldown.ORDER_ACCESS_REQUEST_COOLDOWN_SECONDS = '10';
    expect(() => validateEnvironment(weakCooldown)).toThrow(
      'ORDER_ACCESS_REQUEST_COOLDOWN_SECONDS',
    );
  });

  it('rechaza MongoDB standalone porque no soporta las transacciones requeridas', () => {
    const environment = productionEnvironment();
    environment.MONGODB_URI = 'mongodb://mongo:27017/api_sorteos';
    expect(() => validateEnvironment(environment)).toThrow('replica set');
  });

  it('no permite activar pagos simulados accidentalmente en producción', () => {
    const environment = productionEnvironment();
    environment.PAYMENTS_PROVIDER = 'mock';
    expect(() => validateEnvironment(environment)).toThrow(
      'PAYMENTS_ALLOW_MOCK=true',
    );
  });

  it('solo permite el endpoint HTTPS oficial de CAIXA para la Federal', () => {
    const environment = productionEnvironment();
    environment.CAIXA_FEDERAL_API_BASE_URL =
      'https://attacker.example/portaldeloterias/api/federal';
    expect(() => validateEnvironment(environment)).toThrow(
      'endpoint HTTPS oficial',
    );
  });

  it('acepta los hosts servicebus2 y servicebus3 oficiales', () => {
    const environment = productionEnvironment();
    environment.CAIXA_FEDERAL_API_BASE_URL =
      'https://servicebus2.caixa.gov.br/portaldeloterias/api/federal';
    expect(validateEnvironment(environment)).toEqual(environment);
  });

  it('rechaza incluso un puerto HTTPS explícito en el endpoint CAIXA', () => {
    const environment = productionEnvironment();
    environment.CAIXA_FEDERAL_API_BASE_URL =
      'https://servicebus3.caixa.gov.br:443/portaldeloterias/api/federal';
    expect(() => validateEnvironment(environment)).toThrow(
      'endpoint HTTPS oficial',
    );
  });

  it('valida los límites de red de la conciliación CAIXA', () => {
    const environment = productionEnvironment();
    environment.CAIXA_FEDERAL_CONFIRMATION_DELAY_MS = '6000';
    expect(() => validateEnvironment(environment)).toThrow(
      'CAIXA_FEDERAL_CONFIRMATION_DELAY_MS',
    );
  });

  it('solo permite la baliza HTTPS oficial de NIST', () => {
    const environment = productionEnvironment();
    environment.DRAW_ENTROPY_BEACON_URL =
      'https://evil.example/beacon/2.0/pulse/last';
    expect(() => validateEnvironment(environment)).toThrow(
      'endpoint HTTPS oficial de NIST',
    );
  });
});
