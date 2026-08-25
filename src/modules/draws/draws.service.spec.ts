import { BadRequestException } from '@nestjs/common';
import { createHash } from 'crypto';
import { Types } from 'mongoose';
import { DrawsService } from './draws.service';
import { DrawResultStatus } from './schemas/draw-result.schema';
import { CampaignStatus, DrawMethod } from '../riffles/schema/raffle.schema';
import { OrderStatus } from '../orders/schemas/order.schema';
import { QuotaStatus } from '../orders/schemas/quota.schema';
import {
  PaymentCurrency,
  PaymentProviderName,
  PaymentStatus,
} from '../payments/payment.enums';

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

function aggregateResult<T>(value: T) {
  const aggregate = {
    session: jest.fn(),
    exec: jest.fn().mockResolvedValue(value),
  };
  aggregate.session.mockReturnValue(aggregate);
  return aggregate;
}

describe('DrawsService verifiable draw workflow', () => {
  let resultModel: Record<string, jest.Mock>;
  let campaignModel: Record<string, jest.Mock>;
  let quotaModel: Record<string, jest.Mock>;
  let orderModel: Record<string, jest.Mock>;
  let paymentModel: Record<string, jest.Mock>;
  let refundOperationModel: Record<string, jest.Mock>;
  let connection: Record<string, jest.Mock>;
  let session: Record<string, jest.Mock>;
  let notifications: Record<string, jest.Mock>;
  let caixaFederal: Record<string, jest.Mock>;
  let entropyBeacon: Record<string, jest.Mock>;
  let config: Record<string, jest.Mock>;
  let service: DrawsService;

  beforeEach(() => {
    resultModel = {
      findOne: jest.fn(),
      findByIdAndUpdate: jest.fn(),
      create: jest.fn(),
    };
    campaignModel = { findById: jest.fn(), findOne: jest.fn() };
    quotaModel = {
      findOne: jest.fn(),
      updateOne: jest.fn().mockResolvedValue({ matchedCount: 1 }),
    };
    orderModel = {
      findById: jest.fn(),
      findOne: jest.fn().mockImplementation(() => queryResult(null)),
      aggregate: jest.fn().mockImplementation(() => aggregateResult([])),
      updateOne: jest.fn().mockResolvedValue({ matchedCount: 1 }),
    };
    paymentModel = {
      findById: jest.fn(),
      findOne: jest.fn().mockImplementation(() => queryResult(null)),
      updateOne: jest.fn().mockResolvedValue({ matchedCount: 1 }),
    };
    refundOperationModel = {
      aggregate: jest.fn().mockImplementation(() => aggregateResult([])),
      findOne: jest.fn().mockImplementation(() => queryResult(null)),
    };
    session = {
      withTransaction: jest.fn(async (work: () => Promise<void>) => work()),
      endSession: jest.fn().mockResolvedValue(undefined),
    };
    connection = { startSession: jest.fn().mockResolvedValue(session) };
    notifications = { create: jest.fn().mockResolvedValue(undefined) };
    caixaFederal = { reconcile: jest.fn() };
    entropyBeacon = {
      readAt: jest.fn().mockResolvedValue({
        sourceUrl: 'https://beacon.nist.gov/beacon/2.0/pulse/last',
        pulseUri: 'https://beacon.nist.gov/beacon/2.0/chain/2/pulse/1916340',
        publishedAt: new Date('2026-08-24T18:55:00.000Z'),
        outputValue: 'a'.repeat(128),
        signatureValue: 'b'.repeat(1024),
        certificateId: 'c'.repeat(128),
        bodySha256: 'd'.repeat(64),
        fetchedAt: new Date('2026-08-24T18:55:05.000Z'),
      }),
    };
    config = { get: jest.fn().mockReturnValue(undefined) };
    service = new DrawsService(
      resultModel as any,
      campaignModel as any,
      quotaModel as any,
      orderModel as any,
      paymentModel as any,
      refundOperationModel as any,
      connection as any,
      notifications as any,
      caixaFederal as any,
      entropyBeacon as any,
      config as any,
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
    const externalEntropy = 'a'.repeat(128);
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
      salesClosedAt: new Date('2026-08-24T18:00:00.000Z'),
      drawDate: new Date('2026-08-24T18:30:00.000Z'),
    });
    campaignModel.findById.mockReturnValue(queryResult(campaign));
    const store = jest
      .spyOn(service as any, 'storeVerifiedResult')
      .mockResolvedValue({ status: DrawResultStatus.Verified });

    await service.verifyCryptographic(
      campaignId.toString(),
      {
        reveal,
      },
      actorId,
    );
    expect(entropyBeacon.readAt).toHaveBeenCalledWith(
      campaign.drawDate,
      campaign.salesClosedAt,
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
          contest: '6020',
        },
        drawDate: new Date('2025-11-22T20:00:00.000Z'),
        salesClosedAt: new Date('2025-11-21T20:00:00.000Z'),
      });
      campaignModel.findById.mockReturnValue(queryResult(campaign));
      caixaFederal.reconcile.mockResolvedValue({
        contest: '6020',
        sourceUrl:
          'https://servicebus3.caixa.gov.br/portaldeloterias/api/federal/6020',
        sourceDrawAt: new Date('2025-11-22T00:00:00.000Z'),
        extraction: 'ESPAÇO DA SORTE — SAO PAULO, SP',
        firstPrize,
        secondPrize,
        normalized: {
          contest: '6020',
          game: 'LOTERIA_FEDERAL',
          drawDate: '2025-11-22',
          prizes: [firstPrize, secondPrize, '000003', '000004', '000005'],
          rateio: [
            { tier: 1, winners: 1, prizeAmount: 500000 },
            { tier: 2, winners: 1, prizeAmount: 35000 },
          ],
        },
        reads: [
          {
            fetchedAt: '2025-11-22T22:00:00.000Z',
            bodySha256: 'a'.repeat(64),
          },
          {
            fetchedAt: '2025-11-22T22:00:00.250Z',
            bodySha256: 'b'.repeat(64),
          },
        ],
      });
      const store = jest
        .spyOn(service as any, 'storeVerifiedResult')
        .mockResolvedValue({ status: DrawResultStatus.Verified });
      const actorId = new Types.ObjectId().toString();

      await service.verifyFederal(campaignId.toString(), {}, actorId);

      expect(caixaFederal.reconcile).toHaveBeenCalledWith('6020');
      expect(store).toHaveBeenCalledWith(
        campaign,
        expect.objectContaining({
          contest: '6020',
          firstPrize,
          secondPrize,
          sourceBodySha256: 'a'.repeat(64),
          sourceConfirmationBodySha256: 'b'.repeat(64),
          evidenceHash: expect.stringMatching(/^[a-f0-9]{64}$/),
          rawEvidence: expect.objectContaining({
            primaryNumber: expected,
            sourceReads: expect.any(Array),
            normalized: expect.objectContaining({ game: 'LOTERIA_FEDERAL' }),
          }),
        }),
        expected,
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
        {},
        new Types.ObjectId().toString(),
      ),
    ).rejects.toThrow(
      'El resultado solo puede verificarse con el 100% vendido',
    );
    expect(caixaFederal.reconcile).not.toHaveBeenCalled();
  });

  it('bloquea la verificación antes de consultar el resultado externo si hay pedidos en revisión', async () => {
    const campaignId = new Types.ObjectId();
    campaignModel.findById.mockReturnValue(
      queryResult(
        document({
          _id: campaignId,
          drawMethod: DrawMethod.FederalLottery,
          status: CampaignStatus.SoldOut,
          soldCount: 100,
          reservedCount: 0,
          totalTitles: 100,
          quotaDigits: 2,
          federalLottery: { contest: '6020' },
        }),
      ),
    );
    orderModel.findOne.mockReturnValueOnce(
      queryResult({ _id: new Types.ObjectId(), status: OrderStatus.InReview }),
    );

    await expect(
      service.verifyFederal(
        campaignId.toString(),
        {},
        new Types.ObjectId().toString(),
      ),
    ).rejects.toThrow('pedidos con liquidación pendiente o en revisión');

    expect(caixaFederal.reconcile).not.toHaveBeenCalled();
  });

  it('rechaza una campaña heredada que abrió ventas sin concurso Federal fijado', async () => {
    const campaignId = new Types.ObjectId();
    campaignModel.findById.mockReturnValue(
      queryResult(
        document({
          _id: campaignId,
          drawMethod: DrawMethod.FederalLottery,
          status: CampaignStatus.SoldOut,
          soldCount: 100,
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
        {},
        new Types.ObjectId().toString(),
      ),
    ).rejects.toThrow('no fijó el concurso Federal');
    expect(caixaFederal.reconcile).not.toHaveBeenCalled();
  });

  it('rechaza un resultado Federal conocido antes del cierre efectivo', async () => {
    const campaignId = new Types.ObjectId();
    campaignModel.findById.mockReturnValue(
      queryResult(
        document({
          _id: campaignId,
          drawMethod: DrawMethod.FederalLottery,
          status: CampaignStatus.SoldOut,
          soldCount: 100,
          reservedCount: 0,
          totalTitles: 100,
          quotaDigits: 2,
          prizeTitle: 'Premio',
          drawDate: new Date('2026-08-24T20:00:00.000Z'),
          salesClosedAt: new Date('2026-08-24T12:00:00.000Z'),
          federalLottery: {
            contest: '6020',
            firstPrizeDigits: 1,
            secondPrizeDigits: 1,
            combination: 'sum',
          },
        }),
      ),
    );
    caixaFederal.reconcile.mockResolvedValue({
      contest: '6020',
      sourceDrawAt: new Date('2026-08-24T00:00:00.000Z'),
    });

    await expect(
      service.verifyFederal(
        campaignId.toString(),
        {},
        new Types.ObjectId().toString(),
      ),
    ).rejects.toThrow('posterior al cierre efectivo de ventas');
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
        new Types.ObjectId().toString(),
      ),
    ).rejects.toThrow('Un resultado publicado es inmutable');
    expect(quotaModel.findOne).not.toHaveBeenCalled();
  });

  it('no permite reintentar una verificación para buscar otro ganador', async () => {
    const campaign = document({
      _id: new Types.ObjectId(),
      drawMethod: DrawMethod.Cryptographic,
      quotaDigits: 3,
      totalTitles: 1_000,
      prizeTitle: 'Premio',
    });
    resultModel.findOne.mockReturnValue(
      queryResult({ status: DrawResultStatus.Verified }),
    );

    await expect(
      (service as any).storeVerifiedResult(
        campaign,
        {},
        '123',
        new Types.ObjectId().toString(),
      ),
    ).rejects.toThrow('ya fue verificado y no puede sustituirse');
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

  it('publica detalle de campaña y evidencia verificable en el resultado público', async () => {
    const campaignId = new Types.ObjectId();
    campaignModel.findOne.mockReturnValue(
      queryResult({
        _id: campaignId,
        name: 'Titan 160',
        slug: 'titan-160',
        prizeTitle: 'Moto ou dinheiro',
        media: [],
      }),
    );
    resultModel.findOne.mockReturnValue(
      queryResult({
        campaign: campaignId,
        status: DrawResultStatus.Published,
        evidenceHash: 'a'.repeat(64),
        calculationRule: 'regra pública',
        outcomes: [
          {
            position: 1,
            prizeTitle: 'Titan',
            winningNumber: '001234',
            winnerSnapshot: {
              name: 'Maria da Silva',
              phone: '+5511999999999',
            },
          },
        ],
      }),
    );

    const result = await service.findPublicByCampaign('titan-160');

    expect(result).toEqual(
      expect.objectContaining({
        campaign: expect.objectContaining({
          id: campaignId.toString(),
          name: 'Titan 160',
          slug: 'titan-160',
        }),
        evidence: {
          evidenceHash: 'a'.repeat(64),
          calculationRule: 'regra pública',
        },
      }),
    );
    expect(result.outcomes[0].winner).toEqual({
      name: 'Maria d. S.',
      phone: '+551****99',
    });
  });

  it('publica un verificado, congela ganadores en campaña y notifica al principal', async () => {
    const campaignId = new Types.ObjectId();
    const userId = new Types.ObjectId();
    const quotaId = new Types.ObjectId();
    const orderId = new Types.ObjectId();
    const paymentId = new Types.ObjectId();
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
          order: orderId,
          user: userId,
          winnerSnapshot: {
            name: 'Maria da Silva',
            phone: '+5511999999999',
          },
        },
      ],
      contest: '6020',
      sourceUrl: 'https://example.com/evidence',
      verifiedBy: new Types.ObjectId(),
    });
    const campaign = document({
      _id: campaignId,
      slug: 'titan-160',
      status: CampaignStatus.AwaitingDraw,
      soldCount: 100,
      totalTitles: 100,
      reservedCount: 0,
      winners: [],
    });
    resultModel.findOne.mockReturnValue(queryResult(result));
    campaignModel.findById.mockReturnValue(queryResult(campaign));
    quotaModel.findOne.mockReturnValue(
      queryResult(
        document({
          _id: quotaId,
          campaign: campaignId,
          number: '001234',
          status: QuotaStatus.Paid,
          order: orderId,
          user: userId,
        }),
      ),
    );
    orderModel.findById.mockReturnValue(
      queryResult(
        document({
          _id: orderId,
          campaign: campaignId,
          payment: paymentId,
          status: OrderStatus.Paid,
          buyer: { name: 'Maria da Silva', phone: '+5511999999999' },
          prizeLifecycleVersion: 0,
        }),
      ),
    );
    paymentModel.findById.mockReturnValue(
      queryResult(
        document({
          _id: paymentId,
          order: orderId,
          campaign: campaignId,
          provider: PaymentProviderName.Mock,
          status: PaymentStatus.Paid,
          amount: 10,
          amountCents: 1_000,
          receivedAmountCents: 0,
          refundedAmountCents: 0,
          refundReservedAmountCents: 0,
          currency: PaymentCurrency.BRL,
          providerRefunds: [],
          refunds: [],
        }),
      ),
    );

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
    expect(quotaModel.updateOne).toHaveBeenCalledWith(
      expect.objectContaining({ _id: quotaId, status: expect.any(Object) }),
      { $inc: { __v: 1 } },
      { session },
    );
    expect(orderModel.updateOne).toHaveBeenCalledWith(
      expect.objectContaining({ _id: orderId, status: OrderStatus.Paid }),
      { $inc: { prizeLifecycleVersion: 1, __v: 1 } },
      { session },
    );
    expect(paymentModel.updateOne).toHaveBeenCalledWith(
      expect.objectContaining({ _id: paymentId, status: PaymentStatus.Paid }),
      { $inc: { __v: 1 } },
      { session },
    );
  });

  it('rechaza publicar si un reembolso parcial reabrió la campaña y redujo los títulos pagados', async () => {
    const campaignId = new Types.ObjectId();
    const result = document({
      campaign: campaignId,
      status: DrawResultStatus.Verified,
      verifiedBy: new Types.ObjectId(),
      outcomes: [
        {
          winningNumber: '001234',
          quota: new Types.ObjectId(),
        },
      ],
    });
    resultModel.findOne.mockReturnValue(queryResult(result));
    campaignModel.findById.mockReturnValue(
      queryResult(
        document({
          _id: campaignId,
          status: CampaignStatus.Active,
          soldCount: 99,
          totalTitles: 100,
          reservedCount: 0,
          winners: [],
        }),
      ),
    );

    await expect(
      service.publish(campaignId.toString(), new Types.ObjectId().toString()),
    ).rejects.toThrow('100% de títulos pagados');

    expect(result.save).not.toHaveBeenCalled();
    expect(paymentModel.findOne).not.toHaveBeenCalled();
  });

  it('impide publicar si un pago de la campaña quedó bajo revisión', async () => {
    const campaignId = new Types.ObjectId();
    const result = document({
      campaign: campaignId,
      status: DrawResultStatus.Verified,
      verifiedBy: new Types.ObjectId(),
      outcomes: [
        {
          winningNumber: '001234',
          quota: new Types.ObjectId(),
        },
      ],
    });
    resultModel.findOne.mockReturnValue(queryResult(result));
    campaignModel.findById.mockReturnValue(
      queryResult(
        document({
          _id: campaignId,
          status: CampaignStatus.AwaitingDraw,
          soldCount: 100,
          totalTitles: 100,
          reservedCount: 0,
          winners: [],
        }),
      ),
    );
    paymentModel.findOne.mockReturnValueOnce(
      queryResult({
        _id: new Types.ObjectId(),
        status: PaymentStatus.UnderReview,
      }),
    );

    await expect(
      service.publish(campaignId.toString(), new Types.ObjectId().toString()),
    ).rejects.toThrow('pagos no conciliados');

    expect(result.save).not.toHaveBeenCalled();
    expect(quotaModel.findOne).not.toHaveBeenCalled();
  });

  it('bloquea la ventana entre un reembolso confirmado y su reflejo en el pedido', async () => {
    const campaignId = new Types.ObjectId();
    const result = document({
      campaign: campaignId,
      status: DrawResultStatus.Verified,
      verifiedBy: new Types.ObjectId(),
      outcomes: [
        {
          winningNumber: '001234',
          quota: new Types.ObjectId(),
        },
      ],
    });
    resultModel.findOne.mockReturnValue(queryResult(result));
    campaignModel.findById.mockReturnValue(
      queryResult(
        document({
          _id: campaignId,
          status: CampaignStatus.AwaitingDraw,
          soldCount: 100,
          totalTitles: 100,
          reservedCount: 0,
          winners: [],
        }),
      ),
    );
    orderModel.aggregate.mockReturnValueOnce(
      aggregateResult([{ _id: new Types.ObjectId() }]),
    );

    await expect(
      service.publish(campaignId.toString(), new Types.ObjectId().toString()),
    ).rejects.toThrow('no conserva un pago íntegramente liquidado');

    expect(result.save).not.toHaveBeenCalled();
    expect(quotaModel.findOne).not.toHaveBeenCalled();
  });

  it('impide publicar mientras existe una devolución Processing aunque el pago aún figure Paid', async () => {
    const campaignId = new Types.ObjectId();
    const result = document({
      campaign: campaignId,
      status: DrawResultStatus.Verified,
      verifiedBy: new Types.ObjectId(),
      outcomes: [
        {
          winningNumber: '001234',
          quota: new Types.ObjectId(),
        },
      ],
    });
    resultModel.findOne.mockReturnValue(queryResult(result));
    campaignModel.findById.mockReturnValue(
      queryResult(
        document({
          _id: campaignId,
          status: CampaignStatus.AwaitingDraw,
          soldCount: 100,
          totalTitles: 100,
          reservedCount: 0,
          winners: [],
        }),
      ),
    );
    refundOperationModel.aggregate.mockReturnValueOnce(
      aggregateResult([{ _id: new Types.ObjectId() }]),
    );

    await expect(
      service.publish(campaignId.toString(), new Types.ObjectId().toString()),
    ).rejects.toThrow('devolución Pix aún en procesamiento');

    expect(result.save).not.toHaveBeenCalled();
  });

  it('revalida pago, pedido y cuota dentro de la publicación y bloquea un reembolso concurrente', async () => {
    const campaignId = new Types.ObjectId();
    const userId = new Types.ObjectId();
    const quotaId = new Types.ObjectId();
    const orderId = new Types.ObjectId();
    const paymentId = new Types.ObjectId();
    const result = document({
      campaign: campaignId,
      status: DrawResultStatus.Verified,
      verifiedBy: new Types.ObjectId(),
      outcomes: [
        {
          winningNumber: '001234',
          quota: quotaId,
          order: orderId,
          user: userId,
        },
      ],
    });
    resultModel.findOne.mockReturnValue(queryResult(result));
    const campaign = document({
      _id: campaignId,
      status: CampaignStatus.AwaitingDraw,
      soldCount: 100,
      totalTitles: 100,
      reservedCount: 0,
      winners: [],
    });
    campaignModel.findById.mockReturnValue(queryResult(campaign));
    quotaModel.findOne.mockReturnValue(
      queryResult(
        document({
          _id: quotaId,
          campaign: campaignId,
          number: '001234',
          status: QuotaStatus.Paid,
          order: orderId,
          user: userId,
        }),
      ),
    );
    orderModel.findById.mockReturnValue(
      queryResult(
        document({
          _id: orderId,
          campaign: campaignId,
          payment: paymentId,
          status: OrderStatus.Paid,
          buyer: { name: 'Maria', phone: '+5511999999999' },
        }),
      ),
    );
    paymentModel.findById.mockReturnValue(
      queryResult(
        document({
          _id: paymentId,
          order: orderId,
          campaign: campaignId,
          status: PaymentStatus.Paid,
          refundedAmountCents: 0,
          refundReservedAmountCents: 0,
          providerRefunds: [],
          refunds: [],
        }),
      ),
    );
    paymentModel.updateOne.mockResolvedValueOnce({ matchedCount: 0 });

    await expect(
      service.publish(campaignId.toString(), new Types.ObjectId().toString()),
    ).rejects.toThrow('estado financiero del ganador cambió');

    expect(result.save).not.toHaveBeenCalled();
    expect(campaign.save).not.toHaveBeenCalled();
  });

  it('impide que la misma persona verifique y publique el resultado', async () => {
    const campaignId = new Types.ObjectId();
    const actorId = new Types.ObjectId();
    const result = document({
      campaign: campaignId,
      status: DrawResultStatus.Verified,
      verifiedBy: actorId,
      outcomes: [
        {
          position: 1,
          prizeTitle: 'Titan',
          winningNumber: '001234',
          quota: new Types.ObjectId(),
        },
      ],
    });
    resultModel.findOne.mockReturnValue(queryResult(result));

    await expect(
      service.publish(campaignId.toString(), actorId.toString()),
    ).rejects.toThrow('verificó el resultado no puede publicarlo');
    expect(result.save).not.toHaveBeenCalled();
    expect(campaignModel.findById).not.toHaveBeenCalled();
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
