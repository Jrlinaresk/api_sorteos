import { validateEnvironment } from './environment.validation';

describe('validateEnvironment', () => {
  const productionEnvironment = () => ({
    NODE_ENV: 'production',
    JWT_SECRET: 'j'.repeat(32),
    EMAIL_CODE_SECRET: 'e'.repeat(32),
    PAYMENTS_PUBLIC_SECRET_KEY: 'p'.repeat(32),
    CHECKOUT_ACCESS_SECRET_KEY: 'c'.repeat(32),
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
  });

  it('permite configuración mínima fuera de producción', () => {
    expect(validateEnvironment({ NODE_ENV: 'test' })).toEqual({
      NODE_ENV: 'test',
    });
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
});
