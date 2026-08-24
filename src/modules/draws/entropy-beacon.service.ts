import {
  BadGatewayException,
  ConflictException,
  GatewayTimeoutException,
  Injectable,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'crypto';

const DEFAULT_BEACON_URL = 'https://beacon.nist.gov/beacon/2.0/pulse/last';

export interface EntropyBeaconEvidence {
  sourceUrl: string;
  pulseUri: string;
  publishedAt: Date;
  outputValue: string;
  signatureValue: string;
  certificateId: string;
  bodySha256: string;
  fetchedAt: Date;
}

@Injectable()
export class EntropyBeaconService {
  private readonly sourceUrl: URL;
  private readonly timeoutMs: number;
  private readonly maxResponseBytes: number;

  constructor(private readonly config: ConfigService) {
    this.sourceUrl = this.parseUrl(
      this.config.get<string>('DRAW_ENTROPY_BEACON_URL') || DEFAULT_BEACON_URL,
    );
    this.timeoutMs = this.integerSetting(
      'DRAW_ENTROPY_BEACON_TIMEOUT_MS',
      10_000,
      100,
      30_000,
    );
    this.maxResponseBytes = this.integerSetting(
      'DRAW_ENTROPY_BEACON_MAX_RESPONSE_BYTES',
      262_144,
      1_024,
      1_048_576,
    );
  }

  async readAt(
    targetAt: Date,
    notBefore: Date,
    now = new Date(),
  ): Promise<EntropyBeaconEvidence> {
    if (!Number.isFinite(notBefore.getTime())) {
      throw new ConflictException(
        'No existe una fecha fiable de cierre de ventas para elegir la baliza',
      );
    }
    if (!Number.isFinite(targetAt.getTime()) || targetAt <= notBefore) {
      throw new ConflictException(
        'La fecha comprometida de la baliza debe ser posterior al cierre de ventas',
      );
    }
    if (targetAt > now) {
      throw new ConflictException(
        'La baliza comprometida todavía no fue publicada',
      );
    }
    const requestUrl = this.pulseAtUrl(targetAt);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await fetch(requestUrl, {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          'User-Agent': 'api-sorteos/1.0 NIST-randomness-beacon-verifier',
        },
        cache: 'no-store',
        redirect: 'error',
        signal: controller.signal,
      });
      if (response.status !== 200) {
        throw new BadGatewayException(
          `La baliza NIST respondió con estado HTTP ${response.status}`,
        );
      }
      const mediaType = (response.headers.get('content-type') || '')
        .split(';', 1)[0]
        .trim()
        .toLowerCase();
      if (mediaType !== 'application/json') {
        throw new BadGatewayException(
          'La baliza NIST devolvió un tipo de contenido inesperado',
        );
      }
      const body = await this.readLimitedBody(response, controller);
      let payload: unknown;
      try {
        payload = JSON.parse(body.toString('utf8'));
      } catch {
        throw new BadGatewayException('La baliza NIST devolvió JSON inválido');
      }
      const pulse = this.record(
        this.record(payload, 'respuesta').pulse,
        'pulse',
      );
      if (pulse.statusCode !== 0) {
        throw new BadGatewayException(
          'La baliza NIST informó un pulso no válido',
        );
      }
      const publishedAt = new Date(
        this.requiredText(pulse.timeStamp, 'timeStamp', 40),
      );
      if (!Number.isFinite(publishedAt.getTime())) {
        throw new BadGatewayException(
          'La baliza NIST devolvió una fecha inválida',
        );
      }
      if (publishedAt < targetAt || publishedAt <= notBefore) {
        throw new ConflictException(
          'La baliza NIST no corresponde al instante comprometido posterior al cierre',
        );
      }
      if (publishedAt > now) {
        throw new BadGatewayException(
          'La baliza NIST devolvió una fecha futura',
        );
      }
      const outputValue = this.hex(pulse.outputValue, 'outputValue', 128);
      const signatureValue = this.hex(
        pulse.signatureValue,
        'signatureValue',
        1024,
      );
      const certificateId = this.hex(pulse.certificateId, 'certificateId', 128);
      const pulseUri = this.requiredText(pulse.uri, 'uri', 300);
      const parsedPulseUri = new URL(pulseUri);
      if (
        parsedPulseUri.protocol !== 'https:' ||
        parsedPulseUri.hostname !== 'beacon.nist.gov' ||
        parsedPulseUri.port ||
        parsedPulseUri.username ||
        parsedPulseUri.password ||
        !/^\/beacon\/2\.0\/chain\/\d+\/pulse\/\d+$/.test(
          parsedPulseUri.pathname,
        ) ||
        parsedPulseUri.search ||
        parsedPulseUri.hash
      ) {
        throw new BadGatewayException(
          'La baliza NIST devolvió una URI de pulso no permitida',
        );
      }
      return {
        sourceUrl: requestUrl,
        pulseUri,
        publishedAt,
        outputValue: outputValue.toLowerCase(),
        signatureValue: signatureValue.toLowerCase(),
        certificateId: certificateId.toLowerCase(),
        bodySha256: createHash('sha256').update(body).digest('hex'),
        fetchedAt: now,
      };
    } catch (error) {
      if (
        error instanceof BadGatewayException ||
        error instanceof ConflictException
      ) {
        throw error;
      }
      if (
        controller.signal.aborted ||
        (typeof error === 'object' &&
          error !== null &&
          'name' in error &&
          error.name === 'AbortError')
      ) {
        throw new GatewayTimeoutException(
          'La baliza NIST no respondió dentro del tiempo permitido',
        );
      }
      throw new BadGatewayException(
        'No fue posible consultar la baliza pública NIST',
      );
    } finally {
      clearTimeout(timeout);
    }
  }

  private async readLimitedBody(
    response: Response,
    controller: AbortController,
  ): Promise<Buffer> {
    if (!response.body) {
      throw new BadGatewayException(
        'La baliza NIST devolvió una respuesta vacía',
      );
    }
    const reader = response.body.getReader();
    const chunks: Buffer[] = [];
    let total = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > this.maxResponseBytes) {
        await reader.cancel().catch(() => undefined);
        controller.abort();
        throw new BadGatewayException(
          'La respuesta de la baliza NIST supera el límite permitido',
        );
      }
      chunks.push(Buffer.from(value));
    }
    if (total === 0) {
      throw new BadGatewayException(
        'La baliza NIST devolvió una respuesta vacía',
      );
    }
    return Buffer.concat(chunks, total);
  }

  private parseUrl(value: string): URL {
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      throw new Error('DRAW_ENTROPY_BEACON_URL no es una URL válida');
    }
    if (
      url.protocol !== 'https:' ||
      url.hostname !== 'beacon.nist.gov' ||
      url.port ||
      url.username ||
      url.password ||
      url.pathname !== '/beacon/2.0/pulse/last' ||
      url.search ||
      url.hash
    ) {
      throw new Error(
        'DRAW_ENTROPY_BEACON_URL solo admite el endpoint HTTPS oficial de NIST',
      );
    }
    return url;
  }

  private pulseAtUrl(targetAt: Date): string {
    const url = new URL(this.sourceUrl.toString());
    url.pathname = `/beacon/2.0/pulse/time/next/${targetAt.getTime()}`;
    return url.toString();
  }

  private record(value: unknown, field: string): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new BadGatewayException(
        `La baliza NIST devolvió ${field} inválido`,
      );
    }
    return value as Record<string, unknown>;
  }

  private requiredText(value: unknown, field: string, max: number): string {
    if (typeof value !== 'string' || !value || value.length > max) {
      throw new BadGatewayException(
        `La baliza NIST devolvió ${field} inválido`,
      );
    }
    return value;
  }

  private hex(value: unknown, field: string, length: number): string {
    const text = this.requiredText(value, field, length);
    if (text.length !== length || !/^[a-f0-9]+$/i.test(text)) {
      throw new BadGatewayException(
        `La baliza NIST devolvió ${field} inválido`,
      );
    }
    return text;
  }

  private integerSetting(
    name: string,
    fallback: number,
    minimum: number,
    maximum: number,
  ): number {
    const raw = this.config.get<string>(name);
    if (raw === undefined || raw === '') return fallback;
    const value = Number(raw);
    if (!Number.isInteger(value) || value < minimum || value > maximum) {
      throw new Error(
        `${name} debe ser un entero entre ${minimum} y ${maximum}`,
      );
    }
    return value;
  }
}
