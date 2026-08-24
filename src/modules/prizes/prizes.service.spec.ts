import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { createHash } from 'crypto';
import { Types } from 'mongoose';
import { PrizesService } from './prizes.service';
import {
  InstantPrizeStatus,
  PrizeMechanic,
} from './schemas/instant-prize.schema';
import { PrizeAttemptStatus } from './schemas/prize-attempt.schema';
import { PrizeAwardStatus } from './schemas/prize-award.schema';
import { OrderStatus } from '../orders/schemas/order.schema';
import { QuotaStatus } from '../orders/schemas/quota.schema';

function executable<T>(value: T) {
  const query: Record<string, jest.Mock> = {
    exec: jest.fn().mockResolvedValue(value),
  };
  for (const method of ['select', 'populate', 'sort', 'limit', 'session']) {
    query[method] = jest.fn().mockReturnValue(query);
  }
  return query;
}

function leanable<T>(value: T) {
  const query: Record<string, jest.Mock> = {
    lean: jest.fn().mockResolvedValue(value),
  };
  for (const method of ['select', 'populate', 'sort', 'limit']) {
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

describe('PrizesService inventory and lifecycle', () => {
  let prizeModel: jest.Mock & Record<string, jest.Mock>;
  let attemptModel: jest.Mock & Record<string, jest.Mock>;
  let awardModel: jest.Mock & Record<string, jest.Mock>;
  let campaignModel: Record<string, jest.Mock>;
  let orderModel: Record<string, jest.Mock>;
  let quotaModel: Record<string, jest.Mock>;
  let session: Record<string, jest.Mock>;
  let connection: Record<string, jest.Mock>;
  let orders: Record<string, jest.Mock>;
  let media: Record<string, jest.Mock>;
  let service: PrizesService;

  beforeEach(() => {
    prizeModel = jest.fn() as jest.Mock & Record<string, jest.Mock>;
    prizeModel.findOneAndUpdate = jest.fn();
    prizeModel.find = jest.fn();
    prizeModel.findById = jest.fn();
    prizeModel.updateOne = jest.fn();
    attemptModel = jest.fn() as jest.Mock & Record<string, jest.Mock>;
    attemptModel.find = jest.fn();
    attemptModel.findOne = jest.fn();
    awardModel = jest.fn() as jest.Mock & Record<string, jest.Mock>;
    awardModel.find = jest.fn();
    awardModel.findOne = jest.fn();
    campaignModel = { findById: jest.fn() };
    orderModel = {
      findById: jest.fn(),
      updateOne: jest.fn().mockResolvedValue({ modifiedCount: 1 }),
    };
    quotaModel = { find: jest.fn() };
    session = {
      withTransaction: jest.fn(async (work: () => Promise<void>) => work()),
      endSession: jest.fn().mockResolvedValue(undefined),
    };
    connection = { startSession: jest.fn().mockResolvedValue(session) };
    orders = { findByPublicId: jest.fn() };
    media = {
      addReference: jest.fn().mockResolvedValue(undefined),
      removeReference: jest.fn().mockResolvedValue(undefined),
    };
    service = new PrizesService(
      prizeModel as any,
      attemptModel as any,
      awardModel as any,
      campaignModel as any,
      orderModel as any,
      quotaModel as any,
      connection as any,
      orders as any,
      media as any,
    );
  });

  it('normaliza un título premiado, fuerza stock unitario y reserva inventario', async () => {
    const campaignId = new Types.ObjectId();
    campaignModel.findById.mockReturnValue(
      executable({ _id: campaignId, quotaDigits: 3, totalTitles: 1_000 }),
    );
    prizeModel.mockImplementation((payload: Record<string, unknown>) =>
      document({ ...payload, _id: new Types.ObjectId(), awardedCount: 0 }),
    );

    const result = await service.create({
      campaignId: campaignId.toString(),
      title: 'Pix de R$ 100',
      mechanic: PrizeMechanic.WinningTitle,
      quotaNumber: '7',
      stock: 99,
      weight: 1,
    });

    expect(prizeModel).toHaveBeenCalledWith(
      expect.objectContaining({
        campaign: campaignId,
        quotaNumber: '007',
        stock: 1,
      }),
    );
    expect(result.save).toHaveBeenCalledTimes(1);
  });

  it('rechaza números fuera de campaña y quotaNumber en mecánicas aleatorias', async () => {
    const campaignId = new Types.ObjectId();
    campaignModel.findById.mockReturnValue(
      executable({ _id: campaignId, quotaDigits: 2, totalTitles: 100 }),
    );

    await expect(
      service.create({
        campaignId: campaignId.toString(),
        title: 'Fuera de rango',
        mechanic: PrizeMechanic.WinningTitle,
        quotaNumber: '100',
        stock: 1,
        weight: 1,
      }),
    ).rejects.toThrow('Número de cuota fuera del rango de la campaña');

    await expect(
      service.create({
        campaignId: campaignId.toString(),
        title: 'Ruleta',
        mechanic: PrizeMechanic.Roulette,
        quotaNumber: '10',
        stock: 10,
        weight: 1,
      }),
    ).rejects.toThrow('quotaNumber solo corresponde a winning_title');
  });

  it('adjudica una cuota ganadora solo después de pago y agota el stock', async () => {
    const campaignId = new Types.ObjectId();
    const orderId = new Types.ObjectId();
    const quotaId = new Types.ObjectId();
    const prizeId = new Types.ObjectId();
    const awardId = new Types.ObjectId();
    const order = document({
      _id: orderId,
      campaign: campaignId,
      user: new Types.ObjectId(),
      status: OrderStatus.Paid,
      selectedQuantity: 1,
      buyer: { name: 'Maria da Silva', phone: '+5511999999999' },
    });
    const campaign = {
      _id: campaignId,
      instantGame: { enabled: false, tiers: [] },
    };
    const quota = document({
      _id: quotaId,
      number: '000007',
      status: QuotaStatus.Paid,
    });
    const definition = document({
      _id: prizeId,
      title: 'Pix R$ 100',
      stock: 1,
      awardedCount: 1,
      status: InstantPrizeStatus.Active,
    });
    const createdAwards: Array<Record<string, any>> = [];
    orderModel.findById.mockReturnValue(executable(order));
    campaignModel.findById.mockReturnValue(executable(campaign));
    quotaModel.find.mockReturnValue(executable([quota]));
    awardModel.findOne.mockReturnValue(executable(null));
    prizeModel.findOneAndUpdate.mockResolvedValue(definition);
    awardModel.mockImplementation((payload: Record<string, unknown>) => {
      const award = document({ ...payload, _id: awardId });
      createdAwards.push(award);
      return award;
    });
    awardModel.find.mockReturnValue(leanable([{ _id: awardId }]));
    attemptModel.find.mockReturnValue(leanable([]));

    const result = await service.awardForPaidOrder(orderId);

    expect(prizeModel.findOneAndUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        campaign: campaignId,
        mechanic: PrizeMechanic.WinningTitle,
        quotaNumber: '000007',
        status: InstantPrizeStatus.Active,
      }),
      { $inc: { awardedCount: 1 } },
      { new: true, session },
    );
    expect(definition.status).toBe(InstantPrizeStatus.Exhausted);
    expect(quota.status).toBe(QuotaStatus.Awarded);
    expect(quota.instantPrize).toBe(awardId);
    expect(createdAwards[0]).toEqual(
      expect.objectContaining({
        order: orderId,
        quota: quotaId,
        mechanic: PrizeMechanic.WinningTitle,
        status: PrizeAwardStatus.Awarded,
      }),
    );
    expect(orderModel.updateOne).toHaveBeenCalledWith(
      { _id: orderId },
      { $addToSet: { instantPrizes: { $each: [awardId] } } },
      { session },
    );
    expect(result).toEqual({
      winningTitles: [{ _id: awardId }],
      gameAttempts: [],
    });
  });

  it('no procesa premios para un pedido que aún no está pagado', async () => {
    orderModel.findById.mockReturnValue(
      executable(
        document({
          _id: new Types.ObjectId(),
          status: OrderStatus.PendingPayment,
        }),
      ),
    );

    await expect(
      service.awardForPaidOrder(new Types.ObjectId()),
    ).rejects.toThrow('Los premios solo se procesan después del pago');
    expect(prizeModel.findOneAndUpdate).not.toHaveBeenCalled();
    expect(session.endSession).toHaveBeenCalledTimes(1);
  });

  it('crea intentos según el mayor tramo elegible y no duplica ordinales', async () => {
    const order = document({
      _id: new Types.ObjectId(),
      campaign: new Types.ObjectId(),
      selectedQuantity: 25,
    });
    const campaign = {
      _id: order.campaign,
      instantGame: {
        enabled: true,
        mechanic: 'scratch',
        tiers: [
          { quantity: 10, attempts: 1 },
          { quantity: 20, attempts: 3 },
          { quantity: 30, attempts: 6 },
        ],
      },
    };
    const existing = document({
      _id: new Types.ObjectId(),
      ordinal: 1,
      status: PrizeAttemptStatus.Pending,
    });
    const created: Array<Record<string, any>> = [];
    attemptModel.find.mockReturnValue(executable([existing]));
    attemptModel.mockImplementation((payload: Record<string, unknown>) => {
      const attempt = document({ ...payload, _id: new Types.ObjectId() });
      created.push(attempt);
      return attempt;
    });

    const attempts = await (service as any).createGameAttempts(
      order,
      campaign,
      session,
    );

    expect(created.map((attempt) => attempt.ordinal)).toEqual([0, 2]);
    expect(attempts.map((attempt: any) => attempt.ordinal)).toEqual([0, 1, 2]);
    for (const attempt of created) {
      expect(attempt.mechanic).toBe(PrizeMechanic.Scratch);
      expect(attempt.entropyCommitment).toBe(
        createHash('sha256').update(attempt.entropyReveal).digest('hex'),
      );
      expect(attempt.accessSecret).toMatch(/^[a-f0-9]{64}$/);
      expect(attempt.save).toHaveBeenCalledWith({ session });
    }
  });

  it('consume un intento una sola vez y demuestra el resultado con entropyReveal', async () => {
    const token = 'attempt-secret-token-1234567890123';
    const reveal = 'fixed-server-entropy';
    const campaignId = new Types.ObjectId();
    const attempt = document({
      _id: new Types.ObjectId(),
      publicId: 'attempt-public-id',
      campaign: campaignId,
      order: new Types.ObjectId(),
      status: PrizeAttemptStatus.Pending,
      mechanic: PrizeMechanic.Roulette,
      accessSecret: createHash('sha256').update(token).digest('hex'),
      entropyReveal: reveal,
    });
    attemptModel.findOne.mockReturnValue(executable(attempt));
    campaignModel.findById.mockReturnValue(
      executable({
        _id: campaignId,
        instantGame: { enabled: true, noPrizeWeight: 1 },
      }),
    );
    prizeModel.find.mockReturnValue(executable([]));

    const result = await service.playAttempt('attempt-public-id', token);

    expect(attempt.status).toBe(PrizeAttemptStatus.Played);
    expect(result).toEqual(
      expect.objectContaining({
        won: false,
        entropyReveal: reveal,
      }),
    );
    expect(result).not.toHaveProperty('accessSecret');
    await expect(
      service.playAttempt('attempt-public-id', token),
    ).rejects.toThrow('Este intento ya fue utilizado');
  });

  it('adjudica atómicamente cuando la ruleta selecciona inventario disponible', async () => {
    const token = 'attempt-secret-token-1234567890123';
    const campaignId = new Types.ObjectId();
    const orderId = new Types.ObjectId();
    const attempt = document({
      _id: new Types.ObjectId(),
      publicId: 'winning-attempt',
      campaign: campaignId,
      order: orderId,
      status: PrizeAttemptStatus.Pending,
      mechanic: PrizeMechanic.Roulette,
      accessSecret: createHash('sha256').update(token).digest('hex'),
      entropyReveal: 'winning-fixed-entropy',
    });
    const chosen = document({
      _id: new Types.ObjectId(),
      title: 'Pix R$ 50',
      weight: 1,
      stock: 2,
      awardedCount: 0,
      status: InstantPrizeStatus.Active,
    });
    const selected = document({ ...chosen, awardedCount: 1 });
    const order = document({
      _id: orderId,
      campaign: campaignId,
      buyer: { name: 'Maria', phone: '+5511999999999' },
    });
    const awardId = new Types.ObjectId();
    attemptModel.findOne.mockReturnValue(executable(attempt));
    campaignModel.findById.mockReturnValue(
      executable({
        _id: campaignId,
        instantGame: { enabled: true, noPrizeWeight: 0 },
      }),
    );
    prizeModel.find.mockReturnValue(executable([chosen]));
    prizeModel.findOneAndUpdate.mockResolvedValue(selected);
    orderModel.findById.mockReturnValue(executable(order));
    awardModel.mockImplementation((payload: Record<string, unknown>) =>
      document({ ...payload, _id: awardId }),
    );

    const result = await service.playAttempt('winning-attempt', token);

    expect(result.won).toBe(true);
    expect(attempt.prize).toBe(selected._id);
    expect(attempt.award).toBe(awardId);
    expect(orderModel.updateOne).toHaveBeenCalledWith(
      { _id: orderId },
      { $addToSet: { instantPrizes: awardId } },
      { session },
    );
  });

  it('protege el intento con token constante y acepta al usuario propietario', async () => {
    const userId = new Types.ObjectId();
    const attempt = document({
      user: userId,
      accessSecret: createHash('sha256').update('right').digest('hex'),
    });
    expect(() => (service as any).assertAttemptOwner(attempt, 'wrong')).toThrow(
      ForbiddenException,
    );
    expect(() =>
      (service as any).assertAttemptOwner(attempt, 'wrong', userId.toString()),
    ).not.toThrow();
  });

  it('permite reclamar una vez al dueño y exige reclamar antes de entregar', async () => {
    const userId = new Types.ObjectId();
    const award = document({
      publicId: 'award-public-id',
      user: userId,
      status: PrizeAwardStatus.Awarded,
    });
    awardModel.findOne.mockReturnValue(executable(award));

    const claimed = await service.claimAsUser(
      'award-public-id',
      userId.toString(),
    );
    await service.claimAsUser('award-public-id', userId.toString());

    expect(claimed.status).toBe(PrizeAwardStatus.Claimed);
    expect(claimed.claimedAt).toBeInstanceOf(Date);
    expect(award.save).toHaveBeenCalledTimes(1);

    award.status = PrizeAwardStatus.Awarded;
    await expect(service.fulfill('award-public-id')).rejects.toThrow(
      'El premio debe estar reclamado antes de entregarse',
    );
  });

  it('rechaza reclamar premios de otro usuario o de otro pedido', async () => {
    const award = document({
      publicId: 'award-public-id',
      user: new Types.ObjectId(),
      order: new Types.ObjectId(),
      status: PrizeAwardStatus.Awarded,
    });
    awardModel.findOne.mockReturnValue(executable(award));
    await expect(
      service.claimAsUser('award-public-id', new Types.ObjectId().toString()),
    ).rejects.toBeInstanceOf(ForbiddenException);

    orders.findByPublicId.mockResolvedValue({ _id: new Types.ObjectId() });
    await expect(
      service.claimWithOrderToken(
        'award-public-id',
        'order-public-id',
        'token',
      ),
    ).rejects.toThrow('El premio no pertenece a este pedido');
  });

  it('revierte adjudicaciones tras reembolso y devuelve unidades al inventario', async () => {
    const orderId = new Types.ObjectId();
    const awards = [
      document({
        _id: new Types.ObjectId(),
        prize: new Types.ObjectId(),
        status: PrizeAwardStatus.Awarded,
      }),
      document({
        _id: new Types.ObjectId(),
        prize: new Types.ObjectId(),
        status: PrizeAwardStatus.Claimed,
      }),
    ];
    awardModel.find.mockReturnValue(executable(awards));
    prizeModel.updateOne.mockResolvedValue({ modifiedCount: 1 });

    await expect(service.reverseForOrder(orderId)).resolves.toBe(2);

    expect(
      awards.every((award) => award.status === PrizeAwardStatus.Reversed),
    ).toBe(true);
    expect(prizeModel.updateOne).toHaveBeenCalledTimes(2);
    expect(prizeModel.updateOne).toHaveBeenNthCalledWith(
      1,
      { _id: awards[0].prize, awardedCount: { $gt: 0 } },
      {
        $inc: { awardedCount: -1 },
        $set: { status: InstantPrizeStatus.Active },
      },
      { session },
    );
    expect(session.endSession).toHaveBeenCalledTimes(1);
  });

  it('valida el pedido antes de iniciar una reversión', async () => {
    await expect(service.reverseForOrder('invalid-id')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(connection.startSession).not.toHaveBeenCalled();
  });

  it('solo permite reclamar desde Awarded', async () => {
    const award = document({ status: PrizeAwardStatus.Reversed });
    await expect((service as any).markClaimed(award)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });
});
