import { validateEnvironment } from './environment.validation';

describe('validateEnvironment', () => {
  const productionEnvironment = (): Record<string, string> => ({
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
    ADMIN_PANEL_ORIGINS: 'https://admin.example.com',
    MONGODB_URI:
      'mongodb://mongo:27017/api_sorteos?replicaSet=rs0&authSource=admin',
    SMTP_HOST: 'smtp.example.com',
    SMTP_PORT: '587',
    SMTP_FROM: 'Sorteos <no-reply@example.com>',
    SMTP_USER: 'smtp-user',
    SMTP_PASS: 'smtp-password',
    SMTP_REQUIRE_TLS: 'true',
    SMTP_TLS_REJECT_UNAUTHORIZED: 'true',
    MEDIA_LOCAL_ROOT: '/var/lib/api-sorteos/media',
    PAYMENTS_PROVIDER: 'efi',
    EFI_PIX_CLIENT_ID: 'client-id',
    EFI_PIX_CLIENT_SECRET: 'client-secret',
    EFI_PIX_KEY: 'pix-key',
    EFI_PIX_CERTIFICATE_PATH: __filename,
    EFI_WEBHOOK_HMAC: '',
    EFI_WEBHOOK_REQUIRE_MTLS: 'true',
    EFI_WEBHOOK_MTLS_HEADER: 'x-ssl-client-verify',
    EFI_WEBHOOK_MTLS_SUCCESS_VALUE: 'SUCCESS',
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

  it('solo admite políticas SameSite seguras para la sesión web cliente', () => {
    expect(() =>
      validateEnvironment({
        NODE_ENV: 'test',
        CLIENT_SESSION_COOKIE_SAME_SITE: 'disabled',
      }),
    ).toThrow('CLIENT_SESSION_COOKIE_SAME_SITE debe ser lax, strict o none');
    expect(
      validateEnvironment({
        NODE_ENV: 'test',
        CLIENT_SESSION_COOKIE_SAME_SITE: 'none',
      }),
    ).toEqual({
      NODE_ENV: 'test',
      CLIENT_SESSION_COOKIE_SAME_SITE: 'none',
    });
  });

  it('valida por separado los orígenes que pueden usar la sesión administrativa', () => {
    expect(() =>
      validateEnvironment({
        NODE_ENV: 'test',
        ADMIN_PANEL_ORIGINS: 'https://admin.example.com/panel',
      }),
    ).toThrow('ADMIN_PANEL_ORIGINS solo admite orígenes HTTP(S), sin rutas');
    expect(() =>
      validateEnvironment({
        NODE_ENV: 'test',
        ADMIN_PANEL_ORIGINS: '*',
      }),
    ).toThrow('ADMIN_PANEL_ORIGINS debe contener orígenes explícitos');

    const missing = productionEnvironment();
    delete missing.ADMIN_PANEL_ORIGINS;
    expect(() => validateEnvironment(missing)).toThrow(
      'ADMIN_PANEL_ORIGINS es obligatorio en producción',
    );

    missing.ADMIN_PANEL_ENABLED = 'false';
    expect(validateEnvironment(missing)).toEqual(missing);

    const insecure = productionEnvironment();
    insecure.ADMIN_PANEL_ORIGINS = 'http://admin.example.com';
    expect(() => validateEnvironment(insecure)).toThrow(
      'ADMIN_PANEL_ORIGINS solo admite orígenes HTTPS',
    );
  });

  it('exige HTTPS para todos los orígenes CORS de producción', () => {
    const environment = productionEnvironment();
    environment.CORS_ORIGINS = 'http://rifa.example.com';
    expect(() => validateEnvironment(environment)).toThrow(
      'CORS_ORIGINS solo admite orígenes HTTPS',
    );
  });

  it('rechaza transporte SMTP degradado o certificados no verificados', () => {
    const withoutTls = productionEnvironment();
    withoutTls.SMTP_REQUIRE_TLS = 'false';
    withoutTls.SMTP_SECURE = 'false';
    expect(() => validateEnvironment(withoutTls)).toThrow(
      'SMTP_SECURE=true o SMTP_REQUIRE_TLS=true',
    );

    const unverifiable = productionEnvironment();
    unverifiable.SMTP_TLS_REJECT_UNAUTHORIZED = 'false';
    expect(() => validateEnvironment(unverifiable)).toThrow(
      'SMTP_TLS_REJECT_UNAUTHORIZED=true',
    );

    expect(() =>
      validateEnvironment({ NODE_ENV: 'test', SMTP_SECURE: 'sometimes' }),
    ).toThrow('SMTP_SECURE debe ser true o false');
  });

  it('acota el límite operativo de títulos asignados, incluidos los bonus', () => {
    expect(() =>
      validateEnvironment({
        NODE_ENV: 'test',
        ORDER_MAX_ALLOCATED_TITLES: '10001',
      }),
    ).toThrow('ORDER_MAX_ALLOCATED_TITLES');
    expect(
      validateEnvironment({
        NODE_ENV: 'test',
        ORDER_MAX_ALLOCATED_TITLES: '2000',
      }),
    ).toEqual({
      NODE_ENV: 'test',
      ORDER_MAX_ALLOCATED_TITLES: '2000',
    });
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

  it('no permite sandbox ni un host Efí alternativo en producción', () => {
    const sandbox = productionEnvironment();
    sandbox.EFI_PIX_ENV = 'sandbox';
    expect(() => validateEnvironment(sandbox)).toThrow(
      'EFI_PIX_ENV=production',
    );

    const attacker = productionEnvironment();
    attacker.EFI_PIX_BASE_URL = 'https://payments.attacker.example';
    expect(() => validateEnvironment(attacker)).toThrow(
      'EFI_PIX_BASE_URL debe estar vacío',
    );
  });

  it('exige mTLS para el webhook nativo de Efí en producción', () => {
    const environment = productionEnvironment();
    environment.EFI_WEBHOOK_REQUIRE_MTLS = 'false';
    environment.EFI_WEBHOOK_HMAC = 'h'.repeat(32);
    expect(() => validateEnvironment(environment)).toThrow(
      'EFI_WEBHOOK_REQUIRE_MTLS=true',
    );
  });

  it('valida la defensa HMAC adicional y la cabecera mTLS', () => {
    const weakHmac = productionEnvironment();
    weakHmac.EFI_WEBHOOK_HMAC = 'short';
    expect(() => validateEnvironment(weakHmac)).toThrow(
      'EFI_WEBHOOK_HMAC debe tener al menos 24',
    );

    const invalidHeader = productionEnvironment();
    invalidHeader.EFI_WEBHOOK_MTLS_HEADER = 'bad header';
    expect(() => validateEnvironment(invalidHeader)).toThrow(
      'EFI_WEBHOOK_MTLS_HEADER',
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
