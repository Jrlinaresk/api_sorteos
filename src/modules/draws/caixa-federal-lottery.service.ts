import {
  BadGatewayException,
  ConflictException,
  GatewayTimeoutException,
  Injectable,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'crypto';

const DEFAULT_BASE_URL =
  'https://servicebus3.caixa.gov.br/portaldeloterias/api/federal';
const ALLOWED_CAIXA_HOSTS = new Set([
  'servicebus2.caixa.gov.br',
  'servicebus3.caixa.gov.br',
]);
const SAFE_RESPONSE_HEADERS = [
  'cache-control',
  'content-length',
  'content-type',
  'date',
  'etag',
  'last-modified',
  'x-azion-request-id',
] as const;

interface CaixaRateioTier {
  tier: number;
  winners: number;
  prizeAmount: number;
}

export interface CaixaFederalNormalizedResult {
  contest: string;
  game: 'LOTERIA_FEDERAL';
  drawDate: string;
  prizes: [string, string, string, string, string];
  drawnPrizes?: [string, string, string, string, string];
  rateio: [CaixaRateioTier, CaixaRateioTier];
  nextContest?: string;
  nextDrawDate?: string;
  venue?: string;
  municipality?: string;
}

export interface CaixaFederalUpcomingEvidence {
  contest: string;
  drawDate: Date;
  latestContest: string;
  sourceUrl: string;
  reads: [CaixaFederalSourceRead, CaixaFederalSourceRead];
}

export interface CaixaFederalSourceRead {
  url: string;
  fetchedAt: string;
  status: 200;
  headers: Record<string, string>;
  rawBodyBase64: string;
  bodySha256: string;
  normalized: CaixaFederalNormalizedResult;
}

export interface CaixaFederalReconciliation {
  contest: string;
  sourceUrl: string;
  sourceDrawAt: Date;
  extraction?: string;
  firstPrize: string;
  secondPrize: string;
  normalized: CaixaFederalNormalizedResult;
  reads: [CaixaFederalSourceRead, CaixaFederalSourceRead];
}

@Injectable()
export class CaixaFederalLotteryService {
  private readonly baseUrl: URL;
  private readonly timeoutMs: number;
  private readonly maxResponseBytes: number;
  private readonly confirmationDelayMs: number;

  constructor(private readonly config: ConfigService) {
    this.baseUrl = this.parseBaseUrl(
      this.config.get<string>('CAIXA_FEDERAL_API_BASE_URL') || DEFAULT_BASE_URL,
    );
    this.timeoutMs = this.integerSetting(
      'CAIXA_FEDERAL_TIMEOUT_MS',
      10_000,
      100,
      30_000,
    );
    this.maxResponseBytes = this.integerSetting(
      'CAIXA_FEDERAL_MAX_RESPONSE_BYTES',
      131_072,
      1_024,
      1_048_576,
    );
    this.confirmationDelayMs = this.integerSetting(
      'CAIXA_FEDERAL_CONFIRMATION_DELAY_MS',
      250,
      0,
      5_000,
    );
  }

  async reconcile(contest: string): Promise<CaixaFederalReconciliation> {
    if (!/^[1-9]\d{0,9}$/.test(contest)) {
      throw new BadGatewayException(
        'El concurso Federal configurado no es válido',
      );
    }

    const sourceUrl = this.contestUrl(contest);
    const first = await this.fetchOnce(sourceUrl, contest);
    if (this.confirmationDelayMs > 0) {
      await new Promise<void>((resolve) =>
        setTimeout(resolve, this.confirmationDelayMs),
      );
    }
    const confirmation = await this.fetchOnce(sourceUrl, contest);

    if (
      this.stableJson(first.normalized) !==
      this.stableJson(confirmation.normalized)
    ) {
      throw new BadGatewayException(
        'CAIXA devolvió resultados distintos en las dos lecturas de confirmación',
      );
    }

    const normalized = first.normalized;
    return {
      contest: normalized.contest,
      sourceUrl,
      sourceDrawAt: new Date(`${normalized.drawDate}T00:00:00.000Z`),
      extraction:
        [normalized.venue, normalized.municipality]
          .filter(Boolean)
          .join(' — ') || undefined,
      firstPrize: normalized.prizes[0],
      secondPrize: normalized.prizes[1],
      normalized,
      reads: [first, confirmation],
    };
  }

  /**
   * Confirma contra dos lecturas del endpoint oficial que el concurso es el
   * siguiente aún no publicado y que CAIXA anuncia la misma fecha declarada.
   * Si CAIXA omite cualquiera de esos datos se falla cerrado.
   */
  async assertContestUpcoming(
    contest: string,
    expectedDrawDate: Date,
    now = new Date(),
  ): Promise<CaixaFederalUpcomingEvidence> {
    if (!/^[1-9]\d{0,9}$/.test(contest)) {
      throw new ConflictException(
        'El concurso Federal configurado no es válido',
      );
    }
    if (
      !Number.isFinite(expectedDrawDate.getTime()) ||
      expectedDrawDate <= now
    ) {
      throw new ConflictException(
        'La fecha declarada del sorteo Federal debe ser futura',
      );
    }

    const sourceUrl = this.baseUrl.toString();
    const first = await this.fetchOnce(sourceUrl);
    if (this.confirmationDelayMs > 0) {
      await new Promise<void>((resolve) =>
        setTimeout(resolve, this.confirmationDelayMs),
      );
    }
    const confirmation = await this.fetchOnce(sourceUrl);
    if (
      this.stableJson(first.normalized) !==
      this.stableJson(confirmation.normalized)
    ) {
      throw new BadGatewayException(
        'CAIXA devolvió datos distintos en las dos lecturas del próximo concurso',
      );
    }

    const latest = first.normalized;
    if (Number(contest) <= Number(latest.contest)) {
      throw new ConflictException(
        'El concurso Federal configurado ya fue publicado por CAIXA',
      );
    }
    if (latest.nextContest !== contest) {
      throw new BadGatewayException(
        'CAIXA no confirma el concurso configurado como próximo concurso Federal',
      );
    }
    if (!latest.nextDrawDate) {
      throw new BadGatewayException(
        'CAIXA no publicó una fecha que permita confirmar el próximo concurso Federal',
      );
    }
    if (this.utcDateKey(expectedDrawDate) !== latest.nextDrawDate) {
      throw new ConflictException(
        'La fecha declarada no coincide con la fecha oficial del próximo concurso Federal',
      );
    }
    return {
      contest,
      drawDate: new Date(`${latest.nextDrawDate}T00:00:00.000Z`),
      latestContest: latest.contest,
      sourceUrl,
      reads: [first, confirmation],
    };
  }

  private async fetchOnce(
    url: string,
    expectedContest?: string,
  ): Promise<CaixaFederalSourceRead> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          'User-Agent': 'api-sorteos/1.0 CAIXA-result-verifier',
        },
        cache: 'no-store',
        redirect: 'error',
        signal: controller.signal,
      });
      if (response.status !== 200) {
        throw new BadGatewayException(
          `CAIXA respondió con estado HTTP ${response.status}`,
        );
      }
      const mediaType = (response.headers.get('content-type') || '')
        .split(';', 1)[0]
        .trim()
        .toLowerCase();
      if (mediaType !== 'application/json') {
        throw new BadGatewayException(
          'CAIXA devolvió un tipo de contenido inesperado',
        );
      }

      const declaredLength = response.headers.get('content-length');
      if (
        declaredLength &&
        (!/^\d+$/.test(declaredLength) ||
          Number(declaredLength) > this.maxResponseBytes)
      ) {
        throw new BadGatewayException(
          'La respuesta de CAIXA supera el límite permitido',
        );
      }

      const body = await this.readLimitedBody(response, controller);
      let payload: unknown;
      try {
        payload = JSON.parse(body.toString('utf8'));
      } catch {
        throw new BadGatewayException('CAIXA devolvió JSON inválido');
      }
      const normalized = this.normalizePayload(payload, expectedContest);
      return {
        url,
        fetchedAt: new Date().toISOString(),
        status: 200,
        headers: this.safeHeaders(response.headers),
        rawBodyBase64: body.toString('base64'),
        bodySha256: createHash('sha256').update(body).digest('hex'),
        normalized,
      };
    } catch (error) {
      if (error instanceof BadGatewayException) throw error;
      if (
        controller.signal.aborted ||
        (typeof error === 'object' &&
          error !== null &&
          'name' in error &&
          error.name === 'AbortError')
      ) {
        throw new GatewayTimeoutException(
          'CAIXA no respondió dentro del tiempo permitido',
        );
      }
      throw new BadGatewayException(
        'No fue posible consultar el resultado oficial en CAIXA',
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
      throw new BadGatewayException('CAIXA devolvió una respuesta vacía');
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
          'La respuesta de CAIXA supera el límite permitido',
        );
      }
      chunks.push(Buffer.from(value));
    }
    if (total === 0) {
      throw new BadGatewayException('CAIXA devolvió una respuesta vacía');
    }
    return Buffer.concat(chunks, total);
  }

  private normalizePayload(
    value: unknown,
    expectedContest?: string,
  ): CaixaFederalNormalizedResult {
    const payload = this.record(value, 'respuesta');
    if (
      !Number.isSafeInteger(payload.numero) ||
      Number(payload.numero) < 1 ||
      (expectedContest !== undefined &&
        String(payload.numero) !== expectedContest)
    ) {
      throw new BadGatewayException(
        'El concurso devuelto por CAIXA no coincide con la campaña',
      );
    }
    if (payload.tipoJogo !== 'LOTERIA_FEDERAL') {
      throw new BadGatewayException(
        'CAIXA devolvió un tipo de lotería distinto de Lotería Federal',
      );
    }

    const contest = String(payload.numero);
    const drawDate = this.parseDrawDate(payload.dataApuracao);
    const prizes = this.prizeList(payload.listaDezenas, 'listaDezenas');
    const drawnPrizes =
      payload.dezenasSorteadasOrdemSorteio === undefined ||
      payload.dezenasSorteadasOrdemSorteio === null
        ? undefined
        : this.prizeList(
            payload.dezenasSorteadasOrdemSorteio,
            'dezenasSorteadasOrdemSorteio',
          );
    if (
      drawnPrizes &&
      drawnPrizes.some((number, index) => number !== prizes[index])
    ) {
      throw new BadGatewayException(
        'Las listas de premios de CAIXA no coinciden entre sí',
      );
    }

    if (!Array.isArray(payload.listaRateioPremio)) {
      throw new BadGatewayException(
        'CAIXA devolvió una lista de rateio inválida',
      );
    }
    const rateio = payload.listaRateioPremio.map((entry) =>
      this.rateioTier(entry),
    );
    const seenTiers = new Set<number>();
    for (const item of rateio) {
      if (seenTiers.has(item.tier)) {
        throw new BadGatewayException(
          `CAIXA devolvió la faixa ${item.tier} más de una vez`,
        );
      }
      seenTiers.add(item.tier);
    }
    const tierOne = this.uniqueTier(rateio, 1);
    const tierTwo = this.uniqueTier(rateio, 2);
    const nextContest = this.optionalContest(payload.numeroConcursoProximo);
    const nextDrawDate =
      payload.dataProximoConcurso === undefined ||
      payload.dataProximoConcurso === null ||
      payload.dataProximoConcurso === ''
        ? undefined
        : this.parseDrawDate(payload.dataProximoConcurso, true);
    if (nextContest !== undefined && Number(nextContest) <= Number(contest)) {
      throw new BadGatewayException(
        'CAIXA devolvió un próximo concurso incoherente',
      );
    }

    return {
      contest,
      game: 'LOTERIA_FEDERAL',
      drawDate,
      prizes,
      drawnPrizes,
      rateio: [tierOne, tierTwo],
      nextContest,
      nextDrawDate,
      venue: this.optionalText(payload.localSorteio, 'localSorteio'),
      municipality: this.optionalText(
        payload.nomeMunicipioUFSorteio,
        'nomeMunicipioUFSorteio',
      ),
    };
  }

  private uniqueTier(values: CaixaRateioTier[], tier: number): CaixaRateioTier {
    const matches = values.filter((entry) => entry.tier === tier);
    if (matches.length !== 1) {
      throw new BadGatewayException(
        `CAIXA debe devolver una única faixa ${tier}`,
      );
    }
    return matches[0];
  }

  private rateioTier(value: unknown): CaixaRateioTier {
    const record = this.record(value, 'listaRateioPremio');
    if (!Number.isSafeInteger(record.faixa) || Number(record.faixa) < 1) {
      throw new BadGatewayException('CAIXA devolvió una faixa inválida');
    }
    if (
      !Number.isSafeInteger(record.numeroDeGanhadores) ||
      Number(record.numeroDeGanhadores) < 0
    ) {
      throw new BadGatewayException(
        `CAIXA devolvió ganadores inválidos en la faixa ${record.faixa}`,
      );
    }
    if (
      typeof record.valorPremio !== 'number' ||
      !Number.isFinite(record.valorPremio) ||
      record.valorPremio < 0
    ) {
      throw new BadGatewayException(
        `CAIXA devolvió un premio inválido en la faixa ${record.faixa}`,
      );
    }
    return {
      tier: Number(record.faixa),
      winners: Number(record.numeroDeGanhadores),
      prizeAmount: record.valorPremio,
    };
  }

  private prizeList(
    value: unknown,
    field: string,
  ): [string, string, string, string, string] {
    if (
      !Array.isArray(value) ||
      value.length !== 5 ||
      value.some(
        (number) => typeof number !== 'string' || !/^\d{6}$/.test(number),
      )
    ) {
      throw new BadGatewayException(
        `CAIXA devolvió ${field} con un formato inválido`,
      );
    }
    return value as [string, string, string, string, string];
  }

  private parseDrawDate(value: unknown, allowFuture = false): string {
    if (typeof value !== 'string') {
      throw new BadGatewayException('CAIXA devolvió una fecha inválida');
    }
    const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value);
    if (!match) {
      throw new BadGatewayException('CAIXA devolvió una fecha inválida');
    }
    const [, dayText, monthText, yearText] = match;
    const day = Number(dayText);
    const month = Number(monthText);
    const year = Number(yearText);
    const timestamp = Date.UTC(year, month - 1, day);
    const parsed = new Date(timestamp);
    if (
      parsed.getUTCFullYear() !== year ||
      parsed.getUTCMonth() !== month - 1 ||
      parsed.getUTCDate() !== day
    ) {
      throw new BadGatewayException('CAIXA devolvió una fecha inválida');
    }
    const now = new Date();
    const today = Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate(),
    );
    if (!allowFuture && timestamp > today) {
      throw new BadGatewayException(
        'CAIXA devolvió una fecha de sorteo futura',
      );
    }
    return `${yearText}-${monthText}-${dayText}`;
  }

  private optionalContest(value: unknown): string | undefined {
    if (value === undefined || value === null || value === '') return undefined;
    if (!Number.isSafeInteger(value) || Number(value) < 1) {
      throw new BadGatewayException(
        'CAIXA devolvió un próximo concurso inválido',
      );
    }
    return String(value);
  }

  private utcDateKey(value: Date): string {
    return value.toISOString().slice(0, 10);
  }

  private optionalText(value: unknown, field: string): string | undefined {
    if (value === undefined || value === null || value === '') return undefined;
    if (typeof value !== 'string' || value.length > 200) {
      throw new BadGatewayException(`CAIXA devolvió ${field} inválido`);
    }
    return value;
  }

  private record(value: unknown, field: string): Record<string, any> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new BadGatewayException(`CAIXA devolvió ${field} inválida`);
    }
    return value as Record<string, any>;
  }

  private safeHeaders(headers: Headers): Record<string, string> {
    const safe: Record<string, string> = {};
    for (const name of SAFE_RESPONSE_HEADERS) {
      const value = headers.get(name);
      if (
        value &&
        value.length <= 512 &&
        !/[\u0000-\u001f\u007f]/.test(value)
      ) {
        safe[name] = value;
      }
    }
    return safe;
  }

  private contestUrl(contest: string): string {
    const url = new URL(this.baseUrl.toString());
    url.pathname = `${url.pathname.replace(/\/$/, '')}/${contest}`;
    this.assertAllowedUrl(url);
    return url.toString();
  }

  private parseBaseUrl(value: string): URL {
    const configuredAuthority = /^https:\/\/([^/]+)\//i
      .exec(value.trim())?.[1]
      .toLowerCase();
    if (!configuredAuthority || !ALLOWED_CAIXA_HOSTS.has(configuredAuthority)) {
      throw new Error(
        'La consulta Federal solo admite el endpoint HTTPS oficial de CAIXA',
      );
    }
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      throw new Error('CAIXA_FEDERAL_API_BASE_URL no es una URL válida');
    }
    this.assertAllowedUrl(url);
    const pathname = url.pathname.replace(/\/$/, '');
    if (
      pathname !== '/portaldeloterias/api/federal' ||
      url.search ||
      url.hash
    ) {
      throw new Error(
        'CAIXA_FEDERAL_API_BASE_URL debe apuntar al endpoint oficial Federal',
      );
    }
    url.pathname = pathname;
    return url;
  }

  private assertAllowedUrl(url: URL): void {
    if (
      url.protocol !== 'https:' ||
      url.port ||
      url.username ||
      url.password ||
      !ALLOWED_CAIXA_HOSTS.has(url.hostname.toLowerCase())
    ) {
      throw new Error(
        'La consulta Federal solo admite el endpoint HTTPS oficial de CAIXA',
      );
    }
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

  private stableJson(value: unknown): string {
    if (Array.isArray(value)) {
      return `[${value.map((item) => this.stableJson(item)).join(',')}]`;
    }
    if (value && typeof value === 'object') {
      const entries = Object.entries(value as Record<string, unknown>)
        .filter(([, item]) => item !== undefined)
        .sort(([left], [right]) => left.localeCompare(right));
      return `{${entries
        .map(([key, item]) => `${JSON.stringify(key)}:${this.stableJson(item)}`)
        .join(',')}}`;
    }
    return JSON.stringify(value);
  }
}
