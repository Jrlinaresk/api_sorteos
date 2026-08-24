import { PushSubscription } from 'web-push';
import { createECDH } from 'node:crypto';
import { PushProviderKind } from '../schemas/push-subscription.schema';
import { PushSubscriptionCandidate } from './notification-push-provider';
import { DEFAULT_WEB_PUSH_ENDPOINT_HOSTS } from './web-push.config';

export class InvalidWebPushSubscriptionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidWebPushSubscriptionError';
  }
}

function matchesAllowedHost(hostname: string, pattern: string): boolean {
  if (!pattern.startsWith('*.')) return hostname === pattern;
  const suffix = pattern.slice(1);
  return hostname.endsWith(suffix) && hostname !== suffix.slice(1);
}

function validateKey(
  value: string | undefined,
  expectedBytes: number,
  label: string,
): string {
  if (!value || !/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new InvalidWebPushSubscriptionError(
      `La clave Web Push ${label} es inválida`,
    );
  }
  const decoded = Buffer.from(value, 'base64url');
  if (decoded.length !== expectedBytes) {
    throw new InvalidWebPushSubscriptionError(
      `La clave Web Push ${label} tiene longitud inválida`,
    );
  }
  return value;
}

export function validateWebPushSubscription(
  candidate: PushSubscriptionCandidate,
  allowedHosts: readonly string[] = DEFAULT_WEB_PUSH_ENDPOINT_HOSTS,
): PushSubscription {
  if (candidate.provider !== PushProviderKind.WebPush) {
    throw new InvalidWebPushSubscriptionError(
      'El proveedor de la suscripción no es Web Push',
    );
  }

  let endpoint: URL;
  try {
    endpoint = new URL(candidate.address);
  } catch {
    throw new InvalidWebPushSubscriptionError(
      'El endpoint Web Push no es una URL válida',
    );
  }
  const hostname = endpoint.hostname.toLowerCase();
  if (
    endpoint.protocol !== 'https:' ||
    Boolean(endpoint.username || endpoint.password) ||
    (endpoint.port && endpoint.port !== '443') ||
    !allowedHosts.some((pattern) => matchesAllowedHost(hostname, pattern))
  ) {
    throw new InvalidWebPushSubscriptionError(
      'El endpoint Web Push no pertenece a un servicio permitido',
    );
  }

  const credentialKeys = Object.keys(candidate.credentials);
  if (
    credentialKeys.some((key) => key !== 'p256dh' && key !== 'auth') ||
    credentialKeys.length !== 2
  ) {
    throw new InvalidWebPushSubscriptionError(
      'Las credenciales Web Push deben contener sólo p256dh y auth',
    );
  }
  const p256dh = validateKey(candidate.credentials.p256dh, 65, 'p256dh');
  if (Buffer.from(p256dh, 'base64url')[0] !== 0x04) {
    throw new InvalidWebPushSubscriptionError(
      'La clave Web Push p256dh no es P-256 válida',
    );
  }
  try {
    const curve = createECDH('prime256v1');
    const privateScalar = Buffer.alloc(32);
    privateScalar[31] = 1;
    curve.setPrivateKey(privateScalar);
    curve.computeSecret(Buffer.from(p256dh, 'base64url'));
  } catch {
    throw new InvalidWebPushSubscriptionError(
      'La clave Web Push p256dh no pertenece a la curva P-256',
    );
  }
  const auth = validateKey(candidate.credentials.auth, 16, 'auth');

  return { endpoint: endpoint.toString(), keys: { p256dh, auth } };
}
