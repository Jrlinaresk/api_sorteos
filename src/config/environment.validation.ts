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
    environment.ORDER_MAX_ALLOCATED_TITLES,
    'ORDER_MAX_ALLOCATED_TITLES',
    1,
    10_000,
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
  validateInteger(
    environment.ORDER_ACCESS_TOKEN_HOURS,
    'ORDER_ACCESS_TOKEN_HOURS',
    1,
    168,
  );
  validateInteger(
    environment.PAYMENT_ACCESS_TOKEN_HOURS,
    'PAYMENT_ACCESS_TOKEN_HOURS',
    1,
    168,
  );
  validateInteger(
    environment.PRIZE_ACCESS_TOKEN_HOURS,
    'PRIZE_ACCESS_TOKEN_HOURS',
    1,
    72,
  );
  validateInteger(environment.RATE_LIMIT_MAX, 'RATE_LIMIT_MAX', 1, 100_000);
  validateInteger(
    environment.AUDIT_RETENTION_DAYS,
    'AUDIT_RETENTION_DAYS',
    1,
    3_650,
  );
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
  validateInteger(
    environment.MEDIA_MAX_TOTAL_STORED_BYTES,
    'MEDIA_MAX_TOTAL_STORED_BYTES',
    1,
    10_995_116_277_760,
  );
  validateInteger(
    environment.MEDIA_MAX_STORED_BYTES_PER_USER,
    'MEDIA_MAX_STORED_BYTES_PER_USER',
    1,
    10_995_116_277_760,
  );
  validateInteger(
    environment.MEDIA_DELETED_RETENTION_DAYS,
    'MEDIA_DELETED_RETENTION_DAYS',
    1,
    3_650,
  );
  validateBoolean(
    environment.DRAW_MANUAL_EXTERNAL_ENABLED,
    'DRAW_MANUAL_EXTERNAL_ENABLED',
  );
  validateBoolean(
    environment.DRAW_CRYPTOGRAPHIC_ENABLED,
    'DRAW_CRYPTOGRAPHIC_ENABLED',
  );
  validateBoolean(
    environment.EFI_WEBHOOK_REQUIRE_MTLS,
    'EFI_WEBHOOK_REQUIRE_MTLS',
  );
  validateBoolean(environment.ADMIN_PANEL_ENABLED, 'ADMIN_PANEL_ENABLED');
  validateBoolean(environment.SMTP_SECURE, 'SMTP_SECURE');
  validateBoolean(environment.SMTP_REQUIRE_TLS, 'SMTP_REQUIRE_TLS');
  validateBoolean(
    environment.SMTP_TLS_REJECT_UNAUTHORIZED,
    'SMTP_TLS_REJECT_UNAUTHORIZED',
  );
  validateInteger(
    environment.WEB_PUSH_MAX_SUBSCRIPTIONS_PER_USER,
    'WEB_PUSH_MAX_SUBSCRIPTIONS_PER_USER',
    1,
    50,
  );
  validateNotificationPush(environment);
  validateClientSessionCookie(environment);
  validateAdminPanelOrigins(environment);

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

function validateClientSessionCookie(environment: Environment): void {
  const sameSite =
    text(environment.CLIENT_SESSION_COOKIE_SAME_SITE).toLowerCase() || 'lax';
  if (!['lax', 'strict', 'none'].includes(sameSite)) {
    fail('CLIENT_SESSION_COOKIE_SAME_SITE debe ser lax, strict o none');
  }
}

function validateAdminPanelOrigins(environment: Environment): void {
  const configured = text(environment.ADMIN_PANEL_ORIGINS);
  const production = text(environment.NODE_ENV) === 'production';
  const panelEnabled = text(environment.ADMIN_PANEL_ENABLED) !== 'false';
  if (!configured) {
    if (production && panelEnabled) {
      fail(
        'ADMIN_PANEL_ORIGINS es obligatorio en producción con el panel habilitado',
      );
    }
    return;
  }
  const origins = configured
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  if (!origins.length || origins.includes('*')) {
    fail('ADMIN_PANEL_ORIGINS debe contener orígenes explícitos');
  }
  for (const origin of origins) {
    let parsed: URL;
    try {
      parsed = new URL(origin);
    } catch {
      fail('ADMIN_PANEL_ORIGINS contiene un origen inválido');
    }
    if (
      !['http:', 'https:'].includes(parsed!.protocol) ||
      (production && parsed!.protocol !== 'https:') ||
      parsed!.pathname !== '/' ||
      parsed!.search ||
      parsed!.hash ||
      parsed!.username ||
      parsed!.password
    ) {
      fail(
        production
          ? 'ADMIN_PANEL_ORIGINS solo admite orígenes HTTPS, sin rutas, en producción'
          : 'ADMIN_PANEL_ORIGINS solo admite orígenes HTTP(S), sin rutas',
      );
    }
  }
}

function validateNotificationPush(environment: Environment): void {
  const provider =
    text(environment.NOTIFICATION_PUSH_PROVIDER).toLowerCase() || 'noop';
  if (!['noop', 'webpush'].includes(provider)) {
    fail('NOTIFICATION_PUSH_PROVIDER debe ser noop o webpush');
  }
  if (provider !== 'webpush') return;

  for (const name of [
    'WEB_PUSH_VAPID_SUBJECT',
    'WEB_PUSH_VAPID_PUBLIC_KEY',
    'WEB_PUSH_VAPID_PRIVATE_KEY',
  ]) {
    if (!text(environment[name])) {
      fail(`${name} es obligatorio con NOTIFICATION_PUSH_PROVIDER=webpush`);
    }
  }
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
      parsed!.protocol !== 'https:' ||
      parsed!.pathname !== '/' ||
      parsed!.search ||
      parsed!.hash ||
      parsed!.username ||
      parsed!.password
    ) {
      fail('CORS_ORIGINS solo admite orígenes HTTPS, sin rutas, en producción');
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
  const secure = text(environment.SMTP_SECURE).toLowerCase() === 'true';
  const requireTls = text(environment.SMTP_REQUIRE_TLS).toLowerCase() === 'true';
  if (!secure && !requireTls) {
    fail('SMTP_SECURE=true o SMTP_REQUIRE_TLS=true es obligatorio en producción');
  }
  if (
    text(environment.SMTP_TLS_REJECT_UNAUTHORIZED).toLowerCase() !== 'true'
  ) {
    fail('SMTP_TLS_REJECT_UNAUTHORIZED=true es obligatorio en producción');
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

  const efiEnvironment =
    text(environment.EFI_PIX_ENV).toLowerCase() || 'production';
  if (efiEnvironment !== 'production') {
    fail('EFI_PIX_ENV=production es obligatorio en producción');
  }
  const baseUrl = text(environment.EFI_PIX_BASE_URL);
  if (baseUrl && baseUrl !== 'https://pix.api.efipay.com.br') {
    fail(
      'EFI_PIX_BASE_URL debe estar vacío o ser https://pix.api.efipay.com.br en producción',
    );
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
  if (!requireMtls) {
    fail('EFI_WEBHOOK_REQUIRE_MTLS=true es obligatorio con Efí en producción');
  }
  if (hmac && hmac.length < 24) {
    fail('EFI_WEBHOOK_HMAC debe tener al menos 24 caracteres si se configura');
  }

  const mtlsHeader =
    text(environment.EFI_WEBHOOK_MTLS_HEADER) || 'x-ssl-client-verify';
  if (!/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(mtlsHeader)) {
    fail('EFI_WEBHOOK_MTLS_HEADER no es un nombre de cabecera HTTP válido');
  }
  const mtlsSuccess =
    text(environment.EFI_WEBHOOK_MTLS_SUCCESS_VALUE) || 'SUCCESS';
  if (mtlsSuccess.length > 128 || /[\r\n]/.test(mtlsSuccess)) {
    fail('EFI_WEBHOOK_MTLS_SUCCESS_VALUE no es válido');
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
