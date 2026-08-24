import { ConfigService } from '@nestjs/config';
import { createHash } from 'crypto';
import { CaixaFederalLotteryService } from './caixa-federal-lottery.service';

const OFFICIAL_BASE =
  'https://servicebus3.caixa.gov.br/portaldeloterias/api/federal';

function validPayload() {
  return {
    numero: 6020,
    tipoJogo: 'LOTERIA_FEDERAL',
    dataApuracao: '22/11/2025',
    listaDezenas: ['004492', '094083', '071848', '001932', '054831'],
    dezenasSorteadasOrdemSorteio: [
      '004492',
      '094083',
      '071848',
      '001932',
      '054831',
    ],
    listaRateioPremio: [
      {
        faixa: 1,
        numeroDeGanhadores: 1,
        valorPremio: 500000,
      },
      {
        faixa: 2,
        numeroDeGanhadores: 1,
        valorPremio: 35000,
      },
      {
        faixa: 3,
        numeroDeGanhadores: 1,
        valorPremio: 30000,
      },
    ],
    localSorteio: 'ESPAÇO DA SORTE',
    nomeMunicipioUFSorteio: 'SAO PAULO, SP',
  };
}

function config(overrides: Record<string, string> = {}) {
  const values = {
    CAIXA_FEDERAL_API_BASE_URL: OFFICIAL_BASE,
    CAIXA_FEDERAL_TIMEOUT_MS: '1000',
    CAIXA_FEDERAL_MAX_RESPONSE_BYTES: '131072',
    CAIXA_FEDERAL_CONFIRMATION_DELAY_MS: '0',
    ...overrides,
  };
  return {
    get: jest.fn((name: string) => values[name as keyof typeof values]),
  } as unknown as ConfigService;
}

function jsonResponse(
  payload: unknown,
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { 'content-type': 'application/json; charset=utf-8', ...headers },
  });
}

describe('CaixaFederalLotteryService', () => {
  let fetchMock: jest.SpiedFunction<typeof fetch>;

  beforeEach(() => {
    fetchMock = jest.spyOn(global, 'fetch');
  });

  afterEach(() => {
    fetchMock.mockRestore();
  });

  it('consulta dos veces el endpoint oficial, deriva los premios y guarda evidencia exacta', async () => {
    const body = JSON.stringify(validPayload(), null, 2);
    const headers = {
      'content-type': 'application/json; charset=utf-8',
      date: 'Sat, 22 Nov 2025 22:00:00 GMT',
      etag: '"official-result-6020"',
      'x-azion-request-id': 'safe-request-id',
      'set-cookie': 'secret-cookie=must-not-be-stored',
      'x-internal-edge': 'must-not-be-stored',
    };
    fetchMock
      .mockResolvedValueOnce(new Response(body, { status: 200, headers }))
      .mockResolvedValueOnce(new Response(body, { status: 200, headers }));

    const result = await new CaixaFederalLotteryService(config()).reconcile(
      '6020',
    );

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      `${OFFICIAL_BASE}/6020`,
      expect.objectContaining({
        method: 'GET',
        cache: 'no-store',
        redirect: 'error',
        signal: expect.any(AbortSignal),
      }),
    );
    expect(result).toEqual(
      expect.objectContaining({
        contest: '6020',
        sourceUrl: `${OFFICIAL_BASE}/6020`,
        sourceDrawAt: new Date('2025-11-22T00:00:00.000Z'),
        extraction: 'ESPAÇO DA SORTE — SAO PAULO, SP',
        firstPrize: '004492',
        secondPrize: '094083',
      }),
    );
    expect(result.reads[0].bodySha256).toBe(
      createHash('sha256').update(Buffer.from(body)).digest('hex'),
    );
    expect(
      Buffer.from(result.reads[0].rawBodyBase64, 'base64').toString(),
    ).toBe(body);
    expect(result.reads[0].headers).toEqual({
      'content-type': 'application/json; charset=utf-8',
      date: 'Sat, 22 Nov 2025 22:00:00 GMT',
      etag: '"official-result-6020"',
      'x-azion-request-id': 'safe-request-id',
    });
    expect(result.normalized.rateio).toEqual([
      { tier: 1, winners: 1, prizeAmount: 500000 },
      { tier: 2, winners: 1, prizeAmount: 35000 },
    ]);
  });

  it('admite exclusivamente los dos hosts oficiales conocidos de CAIXA', () => {
    expect(
      () =>
        new CaixaFederalLotteryService(
          config({
            CAIXA_FEDERAL_API_BASE_URL:
              'https://servicebus2.caixa.gov.br/portaldeloterias/api/federal',
          }),
        ),
    ).not.toThrow();
    expect(
      () =>
        new CaixaFederalLotteryService(
          config({
            CAIXA_FEDERAL_API_BASE_URL:
              'https://servicebus3.caixa.gov.br/portaldeloterias/api/federal',
          }),
        ),
    ).not.toThrow();
  });

  it('usa servicebus3 como endpoint oficial predeterminado', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(validPayload()))
      .mockResolvedValueOnce(jsonResponse(validPayload()));
    const defaultConfig = {
      get: jest.fn((name: string) =>
        name === 'CAIXA_FEDERAL_CONFIRMATION_DELAY_MS' ? '0' : undefined,
      ),
    } as unknown as ConfigService;

    await new CaixaFederalLotteryService(defaultConfig).reconcile('6020');

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      'https://servicebus3.caixa.gov.br/portaldeloterias/api/federal/6020',
      expect.any(Object),
    );
  });

  it('conserva ceros y acepta bytes distintos solo si ambas lecturas normalizadas coinciden', async () => {
    const compact = JSON.stringify(validPayload());
    const spaced = JSON.stringify(validPayload(), null, 2);
    fetchMock
      .mockResolvedValueOnce(
        new Response(compact, {
          headers: { 'content-type': 'application/json' },
        }),
      )
      .mockResolvedValueOnce(
        new Response(spaced, {
          headers: { 'content-type': 'application/json' },
        }),
      );

    const result = await new CaixaFederalLotteryService(config()).reconcile(
      '6020',
    );

    expect(result.firstPrize).toBe('004492');
    expect(result.normalized.prizes[3]).toBe('001932');
    expect(result.reads[0].bodySha256).not.toBe(result.reads[1].bodySha256);
  });

  it('rechaza si la segunda lectura oficial no coincide con la primera', async () => {
    const changed = validPayload();
    changed.listaDezenas[1] = '000001';
    changed.dezenasSorteadasOrdemSorteio[1] = '000001';
    fetchMock
      .mockResolvedValueOnce(jsonResponse(validPayload()))
      .mockResolvedValueOnce(jsonResponse(changed));

    await expect(
      new CaixaFederalLotteryService(config()).reconcile('6020'),
    ).rejects.toThrow('resultados distintos');
  });

  it.each([
    ['HTTP', 'http://servicebus3.caixa.gov.br/portaldeloterias/api/federal'],
    ['host', 'https://evil.example/portaldeloterias/api/federal'],
    [
      'subdominio parecido',
      'https://servicebus3.caixa.gov.br.evil.example/portaldeloterias/api/federal',
    ],
    [
      'puerto',
      'https://servicebus3.caixa.gov.br:444/portaldeloterias/api/federal',
    ],
    [
      'puerto HTTPS explícito',
      'https://servicebus3.caixa.gov.br:443/portaldeloterias/api/federal',
    ],
    ['ruta', 'https://servicebus3.caixa.gov.br/otra/api/federal'],
    [
      'query',
      'https://servicebus3.caixa.gov.br/portaldeloterias/api/federal?next=evil',
    ],
  ])('rechaza una base configurada con %s no permitida', (_label, baseUrl) => {
    expect(
      () =>
        new CaixaFederalLotteryService(
          config({ CAIXA_FEDERAL_API_BASE_URL: baseUrl }),
        ),
    ).toThrow(/CAIXA|endpoint oficial/);
  });

  it.each([
    [
      'concurso distinto',
      (payload: any) => {
        payload.numero = 6019;
      },
      'no coincide',
    ],
    [
      'tipo de juego',
      (payload: any) => {
        payload.tipoJogo = 'MEGA_SENA';
      },
      'tipo de lotería',
    ],
    [
      'fecha imposible',
      (payload: any) => {
        payload.dataApuracao = '31/02/2025';
      },
      'fecha inválida',
    ],
    [
      'fecha futura',
      (payload: any) => {
        payload.dataApuracao = '31/12/2999';
      },
      'fecha de sorteo futura',
    ],
    [
      'cantidad de premios',
      (payload: any) => {
        payload.listaDezenas.pop();
      },
      'listaDezenas',
    ],
    [
      'premio sin seis dígitos',
      (payload: any) => {
        payload.listaDezenas[0] = '4492';
      },
      'listaDezenas',
    ],
    [
      'orden sorteado inválido',
      (payload: any) => {
        payload.dezenasSorteadasOrdemSorteio[0] = '4492';
      },
      'dezenasSorteadasOrdemSorteio',
    ],
    [
      'listas contradictorias',
      (payload: any) => {
        payload.dezenasSorteadasOrdemSorteio[0] = '999999';
      },
      'no coinciden',
    ],
    [
      'faixa 1 ausente',
      (payload: any) => {
        payload.listaRateioPremio = payload.listaRateioPremio.filter(
          (entry: any) => entry.faixa !== 1,
        );
      },
      'única faixa 1',
    ],
    [
      'faixa 2 duplicada',
      (payload: any) => {
        payload.listaRateioPremio.push({
          faixa: 2,
          numeroDeGanhadores: 1,
          valorPremio: 35000,
        });
      },
      'faixa 2 más de una vez',
    ],
    [
      'faixa no numérica',
      (payload: any) => {
        payload.listaRateioPremio[2].faixa = '3';
      },
      'faixa inválida',
    ],
    [
      'ganadores negativos',
      (payload: any) => {
        payload.listaRateioPremio[0].numeroDeGanhadores = -1;
      },
      'ganadores inválidos',
    ],
    [
      'valor de premio no numérico',
      (payload: any) => {
        payload.listaRateioPremio[1].valorPremio = '35000';
      },
      'premio inválido',
    ],
  ])('rechaza un payload CAIXA con %s', async (_label, mutate, message) => {
    const payload = validPayload();
    mutate(payload);
    fetchMock.mockResolvedValueOnce(jsonResponse(payload));

    await expect(
      new CaixaFederalLotteryService(config()).reconcile('6020'),
    ).rejects.toThrow(message);
  });

  it.each([
    [
      'estado HTTP',
      () =>
        new Response('{}', {
          status: 503,
          headers: { 'content-type': 'application/json' },
        }),
      'estado HTTP 503',
    ],
    [
      'content-type',
      () => new Response('{}', { headers: { 'content-type': 'text/html' } }),
      'tipo de contenido',
    ],
    [
      'content-length',
      () =>
        new Response('{}', {
          headers: {
            'content-type': 'application/json',
            'content-length': '999999',
          },
        }),
      'supera el límite',
    ],
    [
      'JSON malformado',
      () =>
        new Response('{bad-json', {
          headers: { 'content-type': 'application/json' },
        }),
      'JSON inválido',
    ],
    [
      'cuerpo vacío',
      () =>
        new Response('', {
          headers: { 'content-type': 'application/json' },
        }),
      'respuesta vacía',
    ],
  ])(
    'rechaza una respuesta con %s inválido',
    async (_label, response, message) => {
      fetchMock.mockResolvedValueOnce(response());
      await expect(
        new CaixaFederalLotteryService(config()).reconcile('6020'),
      ).rejects.toThrow(message);
    },
  );

  it('corta un cuerpo transmitido que supera el máximo aunque no declare longitud', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response('x'.repeat(1_025), {
        headers: { 'content-type': 'application/json' },
      }),
    );

    await expect(
      new CaixaFederalLotteryService(
        config({ CAIXA_FEDERAL_MAX_RESPONSE_BYTES: '1024' }),
      ).reconcile('6020'),
    ).rejects.toThrow('supera el límite');
  });

  it('traduce timeout y error de red sin filtrar detalles internos', async () => {
    fetchMock.mockRejectedValueOnce(
      new DOMException('timed out', 'AbortError'),
    );
    await expect(
      new CaixaFederalLotteryService(config()).reconcile('6020'),
    ).rejects.toThrow('tiempo permitido');

    fetchMock.mockRejectedValueOnce(
      new Error('getaddrinfo ENOTFOUND internal-hostname'),
    );
    await expect(
      new CaixaFederalLotteryService(config()).reconcile('6020'),
    ).rejects.toThrow('No fue posible consultar');
  });

  it('rechaza concursos no canónicos antes de hacer red', async () => {
    const service = new CaixaFederalLotteryService(config());
    await expect(service.reconcile('06020')).rejects.toThrow(
      'concurso Federal configurado no es válido',
    );
    await expect(service.reconcile('../6020')).rejects.toThrow(
      'concurso Federal configurado no es válido',
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
