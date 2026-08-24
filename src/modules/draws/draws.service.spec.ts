import { BadRequestException } from '@nestjs/common';
import { createHash } from 'crypto';
import { Types } from 'mongoose';
import { DrawsService } from './draws.service';
import { DrawResultStatus } from './schemas/draw-result.schema';
import { CampaignStatus, DrawMethod } from '../riffles/schema/raffle.schema';

function queryResult<T>(value: T) {
  const query: Record<string, jest.Mock> = {
    exec: jest.fn().mockResolvedValue(value),
  };
  for (const method of [
    'select',
    'populate',
    'sort',
    'skip',
    'limit',
    'lean',
    'session',
  ]) {
    query[method] = jest.fn().mockReturnValue(query);
  }
  return query;
}

function document(payload: Record<string, any>) {
  const value: Record<string, any> = { ...payload, save: jest.fn() };
  value.save.mockResolvedValue(value);
  value.toObject = jest.fn(() => {
    const raw = { ...value };
    delete raw.save;
    delete raw.toObject;
    return raw;
  });
  return value;
}

describe('DrawsService verifiable draw workflow', () => {
  let resultModel: Record<string, jest.Mock>;
  let campaignModel: Record<string, jest.Mock>;
  let quotaModel: Record<string, jest.Mock>;
  let orderModel: Record<string, jest.Mock>;
  let connection: Record<string, jest.Mock>;
  let session: Record<string, jest.Mock>;
  let notifications: Record<string, jest.Mock>;
  let service: DrawsService;

  beforeEach(() => {
    resultModel = {
      findOne: jest.fn(),
      findByIdAndUpdate: jest.fn(),
      create: jest.fn(),
    };
    campaignModel = { findById: jest.fn(), findOne: jest.fn() };
    quotaModel = { findOne: jest.fn() };
    orderModel = { findById: jest.fn() };
    session = {
      withTransaction: jest.fn(async (work: () => Promise<void>) => work()),
      endSession: jest.fn().mockResolvedValue(undefined),
    };
    connection = { startSession: jest.fn().mockResolvedValue(session) };
    notifications = { create: jest.fn().mockResolvedValue(undefined) };
    service = new DrawsService(
      resultModel as any,
      campaignModel as any,
      quotaModel as any,
      orderModel as any,
      connection as any,
      notifications as any,
    );
  });

  it('publica una sola vez el compromiso antes de abrir ventas', async () => {
    const campaignId = new Types.ObjectId();
    const actorId = new Types.ObjectId();
    const committedAt = new Date('2026-08-24T10:00:00.000Z');
    const campaign = document({
      _id: campaignId,
      drawMethod: DrawMethod.Cryptographic,
      status: CampaignStatus.Draft,
      drawCommittedAt: committedAt,
      drawCommittedBy: actorId,
    });
    campaignModel.findById.mockReturnValue(queryResult(campaign));
    const commitment = 'A'.repeat(64);

    const result = await service.commitCryptographic(
      campaignId.toString(),
      { commitment },
      new Types.ObjectId().toString(),
    );

    expect(campaign.drawCommitment).toBe(commitment.toLowerCase());
    expect(campaign.drawCommittedAt).toBe(committedAt);
    expect(campaign.drawCommittedBy).toBe(actorId);
    expect(campaign.save).toHaveBeenCalledTimes(1);
    expect(result.rule).toBe('sha256(campaignId:secret)');
  });

  it('impide sustituir un compromiso ya publicado o crearlo después de abrir ventas', async () => {
    const campaignId = new Types.ObjectId();
    const immutable = document({
      _id: campaignId,
      drawMethod: DrawMethod.Cryptographic,
      status: CampaignStatus.Scheduled,
      drawCommitment: 'a'.repeat(64),
    });
    campaignModel.findById.mockReturnValueOnce(queryResult(immutable));
    await expect(
      service.commitCryptographic(
        campaignId.toString(),
        { commitment: 'b'.repeat(64) },
        new Types.ObjectId().toString(),
      ),
    ).rejects.toThrow('El compromiso criptográfico ya es inmutable');

    const open = document({
      _id: campaignId,
      drawMethod: DrawMethod.Cryptographic,
      status: CampaignStatus.Active,
    });
    campaignModel.findById.mockReturnValueOnce(queryResult(open));
    await expect(
      service.commitCryptographic(
        campaignId.toString(),
        { commitment: 'b'.repeat(64) },
        new Types.ObjectId().toString(),
      ),
    ).rejects.toThrow('El compromiso debe publicarse antes de abrir ventas');
  });

  it('verifica commit-reveal y deriva el título ganador de forma reproducible', async () => {
    const campaignId = new Types.ObjectId();
    const actorId = new Types.ObjectId().toString();
    const reveal = 'secret-material-at-least-16';
    const externalEntropy = 'federal-contest-6020';
    const commitment = createHash('sha256')
      .update(`${campaignId}:${reveal}`)
      .digest('hex');
    const campaign = document({
      _id: campaignId,
      drawMethod: DrawMethod.Cryptographic,
      status: CampaignStatus.SoldOut,
      soldCount: 10_000,
      totalTitles: 10_000,
      quotaDigits: 4,
      prizeTitle: 'Titan 160',
      drawCommitment: commitment,
    });
    campaignModel.findById.mockReturnValue(queryResult(campaign));
    const store = jest
      .spyOn(service as any, 'storeVerifiedResult')
      .mockResolvedValue({ status: DrawResultStatus.Verified });

    await service.verifyCryptographic(
      campaignId.toString(),
      {
        reveal,
        externalEntropy,
        sourceUrl: 'https://example.com/evidence',
      },
      actorId,
    );

    const digest = createHash('sha256')
      .update(`${reveal}:${externalEntropy}:${campaignId}`)
      .digest('hex');
    const expected = (BigInt(`0x${digest}`) % 10_000n)
      .toString()
      .padStart(4, '0');
    expect(store).toHaveBeenCalledWith(
      campaign,
      expect.objectContaining({
        commitment,
        revealedSecret: reveal,
        externalEntropy,
        entropyDigest: digest,
        evidenceHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
      expected,
      [],
      actorId,
    );
  });

  it('rechaza una revelación que no corresponde al commit', async () => {
    const campaignId = new Types.ObjectId();
    campaignModel.findById.mockReturnValue(
      queryResult(
        document({
          _id: campaignId,
          drawMethod: DrawMethod.Cryptographic,
          status: CampaignStatus.AwaitingDraw,
          soldCount: 100,
          totalTitles: 100,
          quotaDigits: 2,
          drawCommitment: '0'.repeat(64),
        }),
      ),
    );
    const store = jest.spyOn(service as any, 'storeVerifiedResult');

    await expect(
      service.verifyCryptographic(
        campaignId.toString(),
        {
          reveal: 'a-different-secret-value',
          externalEntropy: 'entropy-123',
          sourceUrl: 'https://example.com/evidence',
        },
        new Types.ObjectId().toString(),
      ),
    ).rejects.toThrow('La revelación no corresponde al compromiso publicado');
    expect(store).not.toHaveBeenCalled();
  });

  it.each([
    [
      'concatenate',
      {
        totalTitles: 1_000_000,
        quotaDigits: 6,
        firstPrizeDigits: 3,
        secondPrizeDigits: 3,
      },
      '12345',
      '67890',
      '345890',
    ],
    [
      'sum',
      {
        totalTitles: 1_000,
        quotaDigits: 3,
        firstPrizeDigits: 3,
        secondPrizeDigits: 3,
      },
      '12345',
      '67890',
      '235',
    ],
  ])(
    'aplica exactamente la regla Federal %s',
    async (combination, config, firstPrize, secondPrize, expected) => {
      const campaignId = new Types.ObjectId();
      const campaign = document({
        _id: campaignId,
        drawMethod: DrawMethod.FederalLottery,
        status: CampaignStatus.SoldOut,
        soldCount: config.totalTitles,
        totalTitles: config.totalTitles,
        quotaDigits: config.quotaDigits,
        prizeTitle: 'Premio principal',
        federalLottery: {
          firstPrizeDigits: config.firstPrizeDigits,
          secondPrizeDigits: config.secondPrizeDigits,
          combination,
        },
      });
      campaignModel.findById.mockReturnValue(queryResult(campaign));
      const store = jest
        .spyOn(service as any, 'storeVerifiedResult')
        .mockResolvedValue({ status: DrawResultStatus.Verified });
      const actorId = new Types.ObjectId().toString();

      await service.verifyFederal(
        campaignId.toString(),
        {
          contest: '6020',
          firstPrize,
          secondPrize,
          sourceUrl: 'https://loterias.caixa.gov.br/resultados',
        },
        actorId,
      );

      expect(store).toHaveBeenCalledWith(
        campaign,
        expect.objectContaining({
          evidenceHash: expect.stringMatching(/^[a-f0-9]{64}$/),
          rawEvidence: expect.objectContaining({ primaryNumber: expected }),
        }),
        expected,
        [],
        actorId,
      );
    },
  );

  it('exige método, estado sorteable y venta completa antes de verificar', async () => {
    const campaignId = new Types.ObjectId();
    campaignModel.findById.mockReturnValue(
      queryResult(
        document({
          _id: campaignId,
          drawMethod: DrawMethod.FederalLottery,
          status: CampaignStatus.SoldOut,
          soldCount: 99,
          totalTitles: 100,
          quotaDigits: 2,
          federalLottery: {
            firstPrizeDigits: 1,
            secondPrizeDigits: 1,
            combination: 'sum',
          },
        }),
      ),
    );

    await expect(
      service.verifyFederal(
        campaignId.toString(),
        {
          contest: '1',
          firstPrize: '10',
          secondPrize: '20',
          sourceUrl: 'https://example.com',
        },
        new Types.ObjectId().toString(),
      ),
    ).rejects.toThrow(
      'El resultado solo puede verificarse con el 100% vendido',
    );
  });

  it('hace el hash de evidencia estable ante distinto orden de claves', () => {
    const left = (service as any).evidenceHash({
      nested: { z: 3, a: 1 },
      contest: '6020',
    });
    const right = (service as any).evidenceHash({
      contest: '6020',
      nested: { a: 1, z: 3 },
    });
    expect(left).toBe(right);
  });

  it('impide reemplazar incluso por verificación interna un resultado publicado', async () => {
    const campaign = document({
      _id: new Types.ObjectId(),
      drawMethod: DrawMethod.ManualExternal,
      quotaDigits: 3,
      totalTitles: 1_000,
      prizeTitle: 'Premio',
    });
    resultModel.findOne.mockReturnValue(
      queryResult({ status: DrawResultStatus.Published }),
    );

    await expect(
      (service as any).storeVerifiedResult(
        campaign,
        {},
        '123',
        [],
        new Types.ObjectId().toString(),
      ),
    ).rejects.toThrow('Un resultado publicado es inmutable');
    expect(quotaModel.findOne).not.toHaveBeenCalled();
  });

  it('publicar es idempotente cuando el resultado ya era público', async () => {
    const campaignId = new Types.ObjectId();
    const published = document({
      campaign: campaignId,
      status: DrawResultStatus.Published,
      outcomes: [
        {
          position: 1,
          prizeTitle: 'Titan',
          winningNumber: '123456',
          quota: new Types.ObjectId(),
          winnerSnapshot: {
            name: 'Maria da Silva',
            phone: '+5511999999999',
          },
        },
      ],
    });
    resultModel.findOne.mockReturnValue(queryResult(published));
    const campaign = document({
      _id: campaignId,
      slug: 'titan-160',
      status: CampaignStatus.Drawn,
      winners: [],
    });
    campaignModel.findById.mockReturnValue(queryResult(campaign));

    const first = await service.publish(
      campaignId.toString(),
      new Types.ObjectId().toString(),
    );
    const second = await service.publish(
      campaignId.toString(),
      new Types.ObjectId().toString(),
    );

    expect(first).toEqual(second);
    expect(first.outcomes[0].winner).toEqual({
      name: 'Maria d. S.',
      phone: '+551****99',
    });
    expect(published.save).not.toHaveBeenCalled();
    expect(campaign.save).toHaveBeenCalledTimes(2);
    expect(session.endSession).toHaveBeenCalledTimes(2);
  });

  it('publica un verificado, congela ganadores en campaña y notifica al principal', async () => {
    const campaignId = new Types.ObjectId();
    const userId = new Types.ObjectId();
    const quotaId = new Types.ObjectId();
    const actorId = new Types.ObjectId().toString();
    const result = document({
      campaign: campaignId,
      status: DrawResultStatus.Verified,
      outcomes: [
        {
          position: 1,
          prizeTitle: 'Titan',
          winningNumber: '001234',
          quota: quotaId,
          user: userId,
          winnerSnapshot: {
            name: 'Maria da Silva',
            phone: '+5511999999999',
          },
        },
      ],
      contest: '6020',
      sourceUrl: 'https://example.com/evidence',
    });
    const campaign = document({
      _id: campaignId,
      slug: 'titan-160',
      status: CampaignStatus.AwaitingDraw,
      winners: [],
    });
    resultModel.findOne.mockReturnValue(queryResult(result));
    campaignModel.findById.mockReturnValue(queryResult(campaign));

    const response = await service.publish(campaignId.toString(), actorId);

    expect(result.status).toBe(DrawResultStatus.Published);
    expect(result.publishedBy.toString()).toBe(actorId);
    expect(campaign.status).toBe(CampaignStatus.Drawn);
    expect(campaign.mainWinner).toBe(userId);
    expect(campaign.winners).toEqual([userId]);
    expect(campaign.winningQuotaNumber).toBe('001234');
    expect(notifications.create).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: userId.toString(),
        data: { campaignId: campaignId.toString(), winningNumber: '001234' },
      }),
    );
    expect(response).not.toHaveProperty('publishedBy');
    expect(response.outcomes[0].winner.name).toBe('Maria d. S.');
  });

  it('valida identificadores antes de consultar modelos', async () => {
    await expect(
      service.commitCryptographic(
        'not-an-object-id',
        { commitment: 'a'.repeat(64) },
        'actor',
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(campaignModel.findById).not.toHaveBeenCalled();
  });
});
