import { Urgency } from 'web-push';
import { createECDH } from 'node:crypto';

export const DEFAULT_WEB_PUSH_ENDPOINT_HOSTS = [
  'fcm.googleapis.com',
  'updates.push.services.mozilla.com',
  'push.services.mozilla.com',
  'web.push.apple.com',
  '*.notify.windows.com',
] as const;

interface ConfigurationReader {
  get<T = unknown>(key: string): T | undefined;
}

export interface WebPushConfiguration {
  subject: string;
  publicKey: string;
  privateKey: string;
  ttlSeconds: number;
  timeoutMs: number;
  urgency: Urgency;
  maxPayloadBytes: number;
  maxConcurrency: number;
  allowedEndpointHosts: string[];
}

function readString(config: ConfigurationReader, key: string): string {
  const value = config.get<string>(key);
  return typeof value === 'string' ? value.trim() : '';
}

function readInteger(
  config: ConfigurationReader,
  key: string,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const raw = config.get<string | number>(key);
  if (raw === undefined || raw === '') return fallback;
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${key} debe ser un entero entre ${minimum} y ${maximum}`);
  }
  return parsed;
}

function validateVapidKey(
  value: string,
  expectedBytes: number,
  variable: string,
): void {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new Error(`${variable} debe usar Base64 URL-safe sin padding`);
  }
  const decoded = Buffer.from(value, 'base64url');
  if (decoded.length !== expectedBytes) {
    throw new Error(`${variable} tiene una longitud inválida`);
  }
}

function validateSubject(subject: string): void {
  let url: URL;
  try {
    url = new URL(subject);
  } catch {
    throw new Error('WEB_PUSH_VAPID_SUBJECT debe ser una URL https: o mailto:');
  }
  if (url.protocol !== 'https:' && url.protocol !== 'mailto:') {
    throw new Error('WEB_PUSH_VAPID_SUBJECT debe ser una URL https: o mailto:');
  }
}

function normalizeEndpointHostPattern(value: string): string {
  const pattern = value.trim().toLowerCase();
  const host = pattern.startsWith('*.') ? pattern.slice(2) : pattern;
  if (
    !host ||
    host === 'localhost' ||
    !/^[a-z0-9.-]+$/.test(host) ||
    host.startsWith('.') ||
    host.endsWith('.') ||
    host.includes('..')
  ) {
    throw new Error(
      'WEB_PUSH_ALLOWED_ENDPOINT_HOSTS contiene un host inválido',
    );
  }
  return pattern.startsWith('*.') ? `*.${host}` : host;
}

export function readAllowedWebPushEndpointHosts(
  config: ConfigurationReader,
): string[] {
  const configured = readString(config, 'WEB_PUSH_ALLOWED_ENDPOINT_HOSTS');
  const values = configured
    ? configured.split(',')
    : [...DEFAULT_WEB_PUSH_ENDPOINT_HOSTS];
  const normalized = values.map(normalizeEndpointHostPattern);
  return [...new Set(normalized)];
}

export function readWebPushConfiguration(
  config: ConfigurationReader,
): WebPushConfiguration | null {
  const subject = readString(config, 'WEB_PUSH_VAPID_SUBJECT');
  const publicKey = readString(config, 'WEB_PUSH_VAPID_PUBLIC_KEY');
  const privateKey = readString(config, 'WEB_PUSH_VAPID_PRIVATE_KEY');
  const configuredCount = [subject, publicKey, privateKey].filter(
    Boolean,
  ).length;

  if (configuredCount === 0) return null;
  if (configuredCount !== 3) {
    const missing = [
      ['WEB_PUSH_VAPID_SUBJECT', subject],
      ['WEB_PUSH_VAPID_PUBLIC_KEY', publicKey],
      ['WEB_PUSH_VAPID_PRIVATE_KEY', privateKey],
    ]
      .filter(([, value]) => !value)
      .map(([key]) => key)
      .join(', ');
    throw new Error(`Configuración Web Push incompleta; faltan: ${missing}`);
  }

  validateSubject(subject);
  validateVapidKey(publicKey, 65, 'WEB_PUSH_VAPID_PUBLIC_KEY');
  if (Buffer.from(publicKey, 'base64url')[0] !== 0x04) {
    throw new Error('WEB_PUSH_VAPID_PUBLIC_KEY no es una clave P-256 válida');
  }
  validateVapidKey(privateKey, 32, 'WEB_PUSH_VAPID_PRIVATE_KEY');
  try {
    const curve = createECDH('prime256v1');
    curve.setPrivateKey(Buffer.from(privateKey, 'base64url'));
    if (!curve.getPublicKey().equals(Buffer.from(publicKey, 'base64url'))) {
      throw new Error('mismatch');
    }
  } catch {
    throw new Error(
      'Las claves VAPID pública y privada no forman un par válido',
    );
  }

  const urgencyValue =
    readString(config, 'WEB_PUSH_URGENCY') || ('normal' satisfies Urgency);
  if (!['very-low', 'low', 'normal', 'high'].includes(urgencyValue)) {
    throw new Error('WEB_PUSH_URGENCY debe ser very-low, low, normal o high');
  }

  return {
    subject,
    publicKey,
    privateKey,
    ttlSeconds: readInteger(config, 'WEB_PUSH_TTL_SECONDS', 300, 0, 2_419_200),
    timeoutMs: readInteger(
      config,
      'WEB_PUSH_TIMEOUT_MS',
      10_000,
      1_000,
      120_000,
    ),
    urgency: urgencyValue as Urgency,
    maxPayloadBytes: readInteger(
      config,
      'WEB_PUSH_MAX_PAYLOAD_BYTES',
      3_500,
      512,
      4_096,
    ),
    maxConcurrency: readInteger(config, 'WEB_PUSH_MAX_CONCURRENCY', 10, 1, 50),
    allowedEndpointHosts: readAllowedWebPushEndpointHosts(config),
  };
}
