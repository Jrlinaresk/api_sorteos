import { ConfigService } from '@nestjs/config';
import { EntropyBeaconService } from './entropy-beacon.service';

function config(overrides: Record<string, string> = {}) {
  const values = {
    DRAW_ENTROPY_BEACON_URL: 'https://beacon.nist.gov/beacon/2.0/pulse/last',
    DRAW_ENTROPY_BEACON_TIMEOUT_MS: '1000',
    DRAW_ENTROPY_BEACON_MAX_RESPONSE_BYTES: '262144',
    ...overrides,
  };
  return {
    get: jest.fn((name: string) => values[name as keyof typeof values]),
  } as unknown as ConfigService;
}

function payload(timestamp = '2026-08-24T18:55:00.000Z') {
  return {
    pulse: {
      statusCode: 0,
      uri: 'https://beacon.nist.gov/beacon/2.0/chain/2/pulse/1916340',
      timeStamp: timestamp,
      outputValue: 'a'.repeat(128),
      signatureValue: 'b'.repeat(1024),
      certificateId: 'c'.repeat(128),
    },
  };
}

describe('EntropyBeaconService', () => {
  let fetchMock: jest.SpiedFunction<typeof fetch>;

  beforeEach(() => {
    fetchMock = jest.spyOn(global, 'fetch');
  });

  afterEach(() => fetchMock.mockRestore());

  it('obtiene del endpoint allowlisted entropía posterior al cierre', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify(payload()), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    const result = await new EntropyBeaconService(config()).readAt(
      new Date('2026-08-24T18:30:00.000Z'),
      new Date('2026-08-24T18:00:00.000Z'),
      new Date('2026-08-24T19:00:00.000Z'),
    );

    expect(result.outputValue).toBe('a'.repeat(128));
    expect(result.publishedAt).toEqual(new Date('2026-08-24T18:55:00.000Z'));
    expect(result.bodySha256).toMatch(/^[a-f0-9]{64}$/);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://beacon.nist.gov/beacon/2.0/pulse/time/next/1787596200000',
      expect.objectContaining({ redirect: 'error', cache: 'no-store' }),
    );
  });

  it('rechaza una baliza anterior al cierre efectivo', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify(payload('2026-08-24T17:59:00.000Z')), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );

    await expect(
      new EntropyBeaconService(config()).readAt(
        new Date('2026-08-24T18:30:00.000Z'),
        new Date('2026-08-24T18:00:00.000Z'),
        new Date('2026-08-24T19:00:00.000Z'),
      ),
    ).rejects.toThrow('no corresponde al instante comprometido');
  });

  it('no permite sustituir el host o la ruta NIST', () => {
    expect(
      () =>
        new EntropyBeaconService(
          config({
            DRAW_ENTROPY_BEACON_URL:
              'https://evil.example/beacon/2.0/pulse/last',
          }),
        ),
    ).toThrow('endpoint HTTPS oficial de NIST');
  });
});
