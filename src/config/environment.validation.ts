import { existsSync } from 'fs';

type Environment = Record<string, unknown>;

export function validateEnvironment(input: Environment): Environment {
  const environment = { ...input };
  const nodeEnvironment = text(environment.NODE_ENV) || 'development';
  if (!['development', 'test', 'production'].includes(nodeEnvironment)) {
    fail('NODE_ENV debe ser development, test o production');
  }

  validateInteger(environment.PORT, 'PORT', 1, 65_535);
  validateInteger(
    environment.ORDER_RESERVATION_MINUTES,
    'ORDER_RESERVATION_MINUTES',
    5,
    120,
  );
  validateInteger(
    environment.ORDER_ACCESS_MAX_ORDERS,
    'ORDER_ACCESS_MAX_ORDERS',
    1,
    50,
  );
  validateInteger(
    environment.ORDER_ACCESS_REQUEST_COOLDOWN_SECONDS,
    'ORDER_ACCESS_REQUEST_COOLDOWN_SECONDS',
    30,
    3_600,
  );
  validateInteger(environment.RATE_LIMIT_MAX, 'RATE_LIMIT_MAX', 1, 100_000);
  validateInteger(
    environment.RATE_LIMIT_WINDOW_MS,
    'RATE_LIMIT_WINDOW_MS',
    1_000,
    86_400_000,
  );
  validateInteger(
    environment.CAIXA_FEDERAL_TIMEOUT_MS,
    'CAIXA_FEDERAL_TIMEOUT_MS',
    100,
    30_000,
  );
  validateInteger(
    environment.CAIXA_FEDERAL_MAX_RESPONSE_BYTES,
    'CAIXA_FEDERAL_MAX_RESPONSE_BYTES',
    1_024,
    1_048_576,
  );
  validateInteger(
    environment.CAIXA_FEDERAL_CONFIRMATION_DELAY_MS,
    'CAIXA_FEDERAL_CONFIRMATION_DELAY_MS',
    0,
    5_000,
  );
  validateInteger(
    environment.PAYMENTS_OUTBOX_MAX_ATTEMPTS,
    'PAYMENTS_OUTBOX_MAX_ATTEMPTS',
    1,
    50,
  );
  validateInteger(
    environment.PAYMENTS_OUTBOX_LOCK_SECONDS,
    'PAYMENTS_OUTBOX_LOCK_SECONDS',
    30,
    3_600,
  );
  validateInteger(
    environment.PAYMENTS_OUTBOX_BACKOFF_SECONDS,
    'PAYMENTS_OUTBOX_BACKOFF_SECONDS',
    1,
    300,
  );
  validateInteger(
    environment.DRAW_ENTROPY_BEACON_TIMEOUT_MS,
    'DRAW_ENTROPY_BEACON_TIMEOUT_MS',
    100,
    30_000,
  );
  validateInteger(
    environment.DRAW_ENTROPY_BEACON_MAX_RESPONSE_BYTES,
    'DRAW_ENTROPY_BEACON_MAX_RESPONSE_BYTES',
    1_024,
    1_048_576,
  );
  validateBoolean(
    environment.DRAW_MANUAL_EXTERNAL_ENABLED,
    'DRAW_MANUAL_EXTERNAL_ENABLED',
  );
  validateBoolean(
    environment.DRAW_CRYPTOGRAPHIC_ENABLED,
    'DRAW_CRYPTOGRAPHIC_ENABLED',
  );

  if (nodeEnvironment !== 'production') return environment;

  requireSecret(environment, 'JWT_SECRET');
  const emailSecret =
    text(environment.EMAIL_CODE_SECRET) || text(environment.JWT_SECRET);
  if (emailSecret.length < 32) {
    fail('EMAIL_CODE_SECRET o JWT_SECRET debe tener al menos 32 caracteres');
  }
  requireSecret(environment, 'PAYMENTS_PUBLIC_SECRET_KEY');
  requireSecret(environment, 'CHECKOUT_ACCESS_SECRET_KEY');
  requireSecret(environment, 'ORDER_ACCESS_CODE_SECRET');
  requireSecret(environment, 'REFERRAL_IP_HASH_SECRET');

  validateCors(environment);
  validateMongo(environment);
  validateSmtp(environment);
  validatePayments(environment);
  validateCaixaFederal(environment);
  validateEntropyBeacon(environment);

  const mediaRoot = required(environment, 'MEDIA_LOCAL_ROOT');
  if (!mediaRoot.startsWith('/')) {
    fail('MEDIA_LOCAL_ROOT debe ser una ruta absoluta en producción');
  }

  return environment;
}

function validateEntropyBeacon(environment: Environment): void {
  const raw =
    text(environment.DRAW_ENTROPY_BEACON_URL) ||
    'https://beacon.nist.gov/beacon/2.0/pulse/last';
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    fail('DRAW_ENTROPY_BEACON_URL no es una URL válida');
  }
  if (
    url!.protocol !== 'https:' ||
    url!.hostname !== 'beacon.nist.gov' ||
    url!.port ||
    url!.username ||
    url!.password ||
    url!.pathname !== '/beacon/2.0/pulse/last' ||
    url!.search ||
    url!.hash
  ) {
    fail('DRAW_ENTROPY_BEACON_URL debe ser el endpoint HTTPS oficial de NIST');
  }
}

function validateCaixaFederal(environment: Environment): void {
  const raw = required(environment, 'CAIXA_FEDERAL_API_BASE_URL');
  const configuredAuthority = /^https:\/\/([^/]+)\//i
    .exec(raw)?.[1]
    .toLowerCase();
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    fail('CAIXA_FEDERAL_API_BASE_URL no es una URL válida');
  }
  if (
    !configuredAuthority ||
    !['servicebus2.caixa.gov.br', 'servicebus3.caixa.gov.br'].includes(
      configuredAuthority,
    ) ||
    url!.protocol !== 'https:' ||
    !['servicebus2.caixa.gov.br', 'servicebus3.caixa.gov.br'].includes(
      url!.hostname.toLowerCase(),
    ) ||
    url!.port ||
    url!.username ||
    url!.password ||
    url!.pathname.replace(/\/$/, '') !== '/portaldeloterias/api/federal' ||
    url!.search ||
    url!.hash
  ) {
    fail(
      'CAIXA_FEDERAL_API_BASE_URL debe ser el endpoint HTTPS oficial de Lotería Federal',
    );
  }
}

function validateCors(environment: Environment): void {
  const origins = required(environment, 'CORS_ORIGINS')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  if (!origins.length || origins.includes('*')) {
    fail('CORS_ORIGINS debe contener orígenes explícitos');
  }
  for (const origin of origins) {
    let parsed: URL;
    try {
      parsed = new URL(origin);
    } catch {
      fail('CORS_ORIGINS contiene un origen inválido');
    }
    if (
      !['http:', 'https:'].includes(parsed!.protocol) ||
      parsed!.pathname !== '/'
    ) {
      fail('CORS_ORIGINS solo admite orígenes HTTP(S), sin rutas');
    }
  }
}

function validateMongo(environment: Environment): void {
  const uri = required(environment, 'MONGODB_URI');
  if (!/^mongodb(?:\+srv)?:\/\//.test(uri)) {
    fail('MONGODB_URI debe ser una URI de MongoDB válida');
  }
  const usesSrv = uri.startsWith('mongodb+srv://');
  const hasReplicaSet = /[?&]replicaSet=[^&]+/i.test(uri);
  if (!usesSrv && !hasReplicaSet && !text(environment.MONGODB_REPLICA_SET)) {
    fail(
      'MongoDB debe usar replica set porque pedidos y premios son transaccionales',
    );
  }
}

function validateSmtp(environment: Environment): void {
  required(environment, 'SMTP_HOST');
  validateInteger(environment.SMTP_PORT ?? '587', 'SMTP_PORT', 1, 65_535);
  if (!text(environment.SMTP_FROM) && !text(environment.SMTP_USER)) {
    fail('SMTP_FROM o SMTP_USER es obligatorio');
  }
  if (
    Boolean(text(environment.SMTP_USER)) !==
    Boolean(text(environment.SMTP_PASS))
  ) {
    fail('SMTP_USER y SMTP_PASS deben configurarse juntos');
  }
}

function validatePayments(environment: Environment): void {
  const provider = required(environment, 'PAYMENTS_PROVIDER').toLowerCase();
  if (!['efi', 'mock'].includes(provider)) {
    fail('PAYMENTS_PROVIDER debe ser efi o mock');
  }
  if (provider === 'mock') {
    if (text(environment.PAYMENTS_ALLOW_MOCK).toLowerCase() !== 'true') {
      fail(
        'PAYMENTS_ALLOW_MOCK=true es obligatorio para usar mock en producción',
      );
    }
    return;
  }

  for (const name of [
    'EFI_PIX_CLIENT_ID',
    'EFI_PIX_CLIENT_SECRET',
    'EFI_PIX_KEY',
  ]) {
    required(environment, name);
  }

  const p12 = text(environment.EFI_PIX_CERTIFICATE_PATH);
  const cert = text(environment.EFI_PIX_CERT_PATH);
  const key = text(environment.EFI_PIX_KEY_PATH);
  if (!p12 && !(cert && key)) {
    fail(
      'Configure EFI_PIX_CERTIFICATE_PATH o EFI_PIX_CERT_PATH + EFI_PIX_KEY_PATH',
    );
  }
  for (const path of p12 ? [p12] : [cert, key]) {
    if (!existsSync(path))
      fail('No se encontró un certificado Pix configurado');
  }

  const hmac = text(environment.EFI_WEBHOOK_HMAC);
  const requireMtls = text(environment.EFI_WEBHOOK_REQUIRE_MTLS) === 'true';
  if (!requireMtls && hmac.length < 24) {
    fail('Configure mTLS o un EFI_WEBHOOK_HMAC de al menos 24 caracteres');
  }
}

function requireSecret(environment: Environment, name: string): string {
  const value = required(environment, name);
  if (value.length < 32) fail(`${name} debe tener al menos 32 caracteres`);
  return value;
}

function required(environment: Environment, name: string): string {
  const value = text(environment[name]);
  if (!value) fail(`${name} es obligatorio en producción`);
  return value;
}

function validateInteger(
  raw: unknown,
  name: string,
  minimum: number,
  maximum: number,
): void {
  if (raw === undefined || raw === null || raw === '') return;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    fail(`${name} debe ser un entero entre ${minimum} y ${maximum}`);
  }
}

function validateBoolean(raw: unknown, name: string): void {
  if (raw === undefined || raw === null || raw === '') return;
  if (!['true', 'false'].includes(text(raw).toLowerCase())) {
    fail(`${name} debe ser true o false`);
  }
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function fail(message: string): never {
  throw new Error(`Configuración inválida: ${message}`);
}
