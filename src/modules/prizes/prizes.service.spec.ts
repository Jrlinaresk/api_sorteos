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
import {
  PrizeAttemptOutcome,
  PrizeAttemptStatus,
} from './schemas/prize-attempt.schema';
import { PrizeAwardStatus } from './schemas/prize-award.schema';
import { OrderStatus } from '../orders/schemas/order.schema';
import { QuotaStatus } from '../orders/schemas/quota.schema';
import { CampaignStatus } from '../riffles/schema/raffle.schema';

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

function sha256(value: string) {
  return createHash('sha256').update(value).digest('hex');
}

function committedAttempt(
  payload: Record<string, any>,
  configurationSnapshot: {
    version: 1;
    mechanic: PrizeMechanic.Roulette | PrizeMechanic.Scratch;
    noPrizeWeight: number;
    prizes: Array<{
      prizeId: string;
      weight: number;
      stock: number;
      sortOrder: number;
    }>;
  },
) {
  const configurationHash = sha256(JSON.stringify(configurationSnapshot));
  return document({
    ...payload,
    configurationSnapshot,
    configurationHash,
    entropyCommitment: sha256(
      `${payload.entropyReveal}:${configurationHash}:${payload.publicId}`,
    ),
  });
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
    prizeModel.exists = jest.fn().mockReturnValue(executable(null));
    attemptModel = jest.fn() as jest.Mock & Record<string, jest.Mock>;
    attemptModel.find = jest.fn();
    attemptModel.findOne = jest.fn();
    attemptModel.updateMany = jest.fn().mockResolvedValue({ modifiedCount: 0 });
    attemptModel.exists = jest.fn().mockReturnValue(executable(null));
    awardModel = jest.fn() as jest.Mock & Record<string, jest.Mock>;
    awardModel.find = jest.fn();
    awardModel.findOne = jest.fn();
    awardModel.exists = jest.fn().mockReturnValue(executable(null));
    campaignModel = {
      findById: jest.fn(),
      findOneAndUpdate: jest.fn(),
    };
    orderModel = {
      findById: jest.fn(),
      findOne: jest.fn(),
      distinct: jest.fn(),
      updateOne: jest.fn().mockResolvedValue({ modifiedCount: 1 }),
      exists: jest.fn().mockReturnValue(executable(null)),
    };
    quotaModel = { find: jest.fn() };
    session = {
      withTransaction: jest.fn(async (work: () => Promise<void>) => work()),
      endSession: jest.fn().mockResolvedValue(undefined),
    };
    connection = { startSession: jest.fn().mockResolvedValue(session) };
    orders = {
      findByPublicId: jest.fn(),
      findOwnedForCheckout: jest.fn(),
    };
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
    const campaign = {
      _id: campaignId,
      status: CampaignStatus.Draft,
      reservedCount: 0,
      soldCount: 0,
      contractRevision: 0,
      quotaDigits: 3,
      totalTitles: 1_000,
    };
    campaignModel.findById.mockReturnValue(executable(campaign));
    campaignModel.findOneAndUpdate.mockReturnValue(
      executable({ ...campaign, contractRevision: 1 }),
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
    expect(campaignModel.findOneAndUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        _id: campaignId,
        status: CampaignStatus.Draft,
      }),
      { $inc: { contractRevision: 1 } },
      { new: true, runValidators: true, session },
    );
    expect(result.save).toHaveBeenCalledWith({ session });
  });

  it('aborta y compensa el medio si la campaña se publica concurrentemente', async () => {
    const campaignId = new Types.ObjectId();
    const mediaId = new Types.ObjectId().toString();
    campaignModel.findById.mockReturnValue(
      executable({
        _id: campaignId,
        status: CampaignStatus.Draft,
        contractRevision: 3,
        reservedCount: 0,
        soldCount: 0,
      }),
    );
    campaignModel.findOneAndUpdate.mockReturnValue(executable(null));

    await expect(
      service.create({
        campaignId: campaignId.toString(),
        title: 'Premio en carrera',
        mechanic: PrizeMechanic.Roulette,
        stock: 1,
        weight: 1,
        mediaId,
      }),
    ).rejects.toThrow('El contrato cambió');

    expect(prizeModel).not.toHaveBeenCalled();
    expect(media.addReference).toHaveBeenCalledWith(
      mediaId,
      expect.stringMatching(/^prize:/),
    );
    expect(media.removeReference).toHaveBeenCalledWith(
      mediaId,
      expect.stringMatching(/^prize:/),
    );
    expect(session.endSession).toHaveBeenCalled();
  });

  it('rechaza números fuera de campaña y quotaNumber en mecánicas aleatorias', async () => {
    const campaignId = new Types.ObjectId();
    const campaign = {
      _id: campaignId,
      status: CampaignStatus.Draft,
      reservedCount: 0,
      soldCount: 0,
      contractRevision: 0,
      quotaDigits: 2,
      totalTitles: 100,
    };
    campaignModel.findById.mockReturnValue(executable(campaign));
    campaignModel.findOneAndUpdate.mockReturnValue(
      executable({ ...campaign, contractRevision: 1 }),
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

  it('congela crear, editar y borrar premios al salir de Draft', async () => {
    const campaignId = new Types.ObjectId();
    const prizeId = new Types.ObjectId();
    const campaign = {
      _id: campaignId,
      status: CampaignStatus.Active,
      reservedCount: 0,
      soldCount: 0,
      quotaDigits: 6,
      totalTitles: 1_000_000,
    };
    const prize = document({
      _id: prizeId,
      campaign: campaignId,
      title: 'Pix R$ 50',
      mechanic: PrizeMechanic.Roulette,
      weight: 1,
      stock: 5,
      awardedCount: 0,
    });
    prize.deleteOne = jest.fn();
    campaignModel.findById.mockReturnValue(executable(campaign));
    prizeModel.findById.mockReturnValue(executable(prize));

    await expect(
      service.create({
        campaignId: campaignId.toString(),
        title: 'Nuevo premio',
        mechanic: PrizeMechanic.Roulette,
        stock: 1,
        weight: 1,
      }),
    ).rejects.toThrow('solo puede modificarse antes de publicar la campaña');
    await expect(
      service.update(prizeId.toString(), { title: 'Alterado' }),
    ).rejects.toThrow('solo puede modificarse antes de publicar la campaña');
    await expect(service.remove(prizeId.toString())).rejects.toThrow(
      'solo puede modificarse antes de publicar la campaña',
    );

    expect(prizeModel).not.toHaveBeenCalled();
    expect(prize.save).not.toHaveBeenCalled();
    expect(prize.deleteOne).not.toHaveBeenCalled();
  });

  it('congela el plan aunque el estado sea Draft si ya existe actividad', async () => {
    const campaignId = new Types.ObjectId();
    campaignModel.findById.mockReturnValue(
      executable({
        _id: campaignId,
        status: CampaignStatus.Draft,
        reservedCount: 0,
        soldCount: 0,
        quotaDigits: 6,
        totalTitles: 1_000_000,
      }),
    );
    campaignModel.findOneAndUpdate.mockReturnValue(
      executable({
        _id: campaignId,
        status: CampaignStatus.Draft,
        reservedCount: 0,
        soldCount: 0,
        contractRevision: 1,
        quotaDigits: 6,
        totalTitles: 1_000_000,
      }),
    );
    orderModel.exists.mockReturnValue(
      executable({ _id: new Types.ObjectId() }),
    );

    await expect(
      service.create({
        campaignId: campaignId.toString(),
        title: 'Premio tardío',
        mechanic: PrizeMechanic.Roulette,
        stock: 1,
        weight: 1,
      }),
    ).rejects.toThrow('la campaña ya tiene actividad');
    expect(prizeModel).not.toHaveBeenCalled();
  });

  it('no descongela el plan si una campaña programada vuelve a Draft', async () => {
    const campaignId = new Types.ObjectId();
    campaignModel.findById.mockReturnValue(
      executable({
        _id: campaignId,
        status: CampaignStatus.Draft,
        contractLockedAt: new Date(),
        reservedCount: 0,
        soldCount: 0,
        quotaDigits: 6,
        totalTitles: 1_000_000,
      }),
    );

    await expect(
      service.create({
        campaignId: campaignId.toString(),
        title: 'Cambio posterior a publicación',
        mechanic: PrizeMechanic.Roulette,
        stock: 1,
        weight: 1,
      }),
    ).rejects.toThrow('solo puede modificarse antes de publicar la campaña');
    expect(orderModel.exists).not.toHaveBeenCalled();
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
        noPrizeWeight: 0,
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
    prizeModel.find.mockReturnValue(
      executable([
        document({
          _id: new Types.ObjectId('000000000000000000000001'),
          weight: 0,
          stock: 1,
          sortOrder: 0,
        }),
        document({
          _id: new Types.ObjectId('000000000000000000000002'),
          weight: 2,
          stock: 3,
          sortOrder: 1,
        }),
      ]),
    );
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
      expect(attempt.configurationSnapshot).toEqual({
        version: 1,
        mechanic: PrizeMechanic.Scratch,
        noPrizeWeight: 0,
        prizes: [
          {
            prizeId: '000000000000000000000001',
            weight: 0,
            stock: 1,
            sortOrder: 0,
          },
          {
            prizeId: '000000000000000000000002',
            weight: 2,
            stock: 3,
            sortOrder: 1,
          },
        ],
      });
      expect(attempt.configurationHash).toBe(
        sha256(JSON.stringify(attempt.configurationSnapshot)),
      );
      expect(attempt.entropyCommitment).toBe(
        sha256(
          `${attempt.entropyReveal}:${attempt.configurationHash}:${attempt.publicId}`,
        ),
      );
      expect(attempt.accessSecret).toMatch(/^[a-f0-9]{64}$/);
      expect(attempt.save).toHaveBeenCalledWith({ session });
    }
  });

  it('consume un intento una sola vez y demuestra el resultado con entropyReveal', async () => {
    const token = 'attempt-secret-token-1234567890123';
    const reveal = 'fixed-server-entropy';
    const campaignId = new Types.ObjectId();
    const configurationSnapshot = {
      version: 1 as const,
      mechanic: PrizeMechanic.Roulette as const,
      noPrizeWeight: 1,
      prizes: [],
    };
    const attempt = committedAttempt(
      {
        _id: new Types.ObjectId(),
        publicId: 'attempt-public-id',
        campaign: campaignId,
        order: new Types.ObjectId(),
        status: PrizeAttemptStatus.Pending,
        mechanic: PrizeMechanic.Roulette,
        accessSecret: createHash('sha256').update(token).digest('hex'),
        entropyReveal: reveal,
      },
      configurationSnapshot,
    );
    attemptModel.findOne.mockReturnValue(executable(attempt));
    orderModel.findById.mockReturnValue(
      executable({
        _id: attempt.order,
        campaign: campaignId,
        status: OrderStatus.Paid,
      }),
    );
    const result = await service.playAttempt('attempt-public-id', token);

    expect(attempt.status).toBe(PrizeAttemptStatus.Played);
    expect(attempt.outcome).toBe(PrizeAttemptOutcome.NoPrize);
    expect(result).toEqual(
      expect.objectContaining({
        won: false,
        entropyReveal: reveal,
        configurationSnapshot,
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
    const chosen = document({
      _id: new Types.ObjectId(),
      title: 'Pix R$ 50',
      weight: 1,
      stock: 2,
      awardedCount: 0,
      status: InstantPrizeStatus.Active,
    });
    const attempt = committedAttempt(
      {
        _id: new Types.ObjectId(),
        publicId: 'winning-attempt',
        campaign: campaignId,
        order: orderId,
        status: PrizeAttemptStatus.Pending,
        mechanic: PrizeMechanic.Roulette,
        accessSecret: createHash('sha256').update(token).digest('hex'),
        entropyReveal: 'winning-fixed-entropy',
      },
      {
        version: 1,
        mechanic: PrizeMechanic.Roulette,
        noPrizeWeight: 0,
        prizes: [
          {
            prizeId: chosen._id.toString(),
            weight: 1,
            stock: 2,
            sortOrder: 0,
          },
        ],
      },
    );
    const selected = document({ ...chosen, awardedCount: 1 });
    const order = document({
      _id: orderId,
      campaign: campaignId,
      status: OrderStatus.Paid,
      buyer: { name: 'Maria', phone: '+5511999999999' },
    });
    const awardId = new Types.ObjectId();
    attemptModel.findOne.mockReturnValue(executable(attempt));
    prizeModel.findOneAndUpdate.mockResolvedValue(selected);
    orderModel.findById.mockReturnValue(executable(order));
    awardModel.mockImplementation((payload: Record<string, unknown>) =>
      document({ ...payload, _id: awardId }),
    );

    const result = await service.playAttempt('winning-attempt', token);

    expect(result.won).toBe(true);
    expect(attempt.prize).toBe(selected._id);
    expect(attempt.award).toBe(awardId);
    expect(attempt.drawnPrize).toEqual(chosen._id);
    expect(attempt.outcome).toBe(PrizeAttemptOutcome.Awarded);
    expect(orderModel.updateOne).toHaveBeenCalledWith(
      {
        _id: orderId,
        campaign: campaignId,
        status: OrderStatus.Paid,
      },
      { $inc: { prizeLifecycleVersion: 1 } },
      { session },
    );
    expect(prizeModel.findOneAndUpdate).toHaveBeenCalledWith(
      {
        _id: chosen._id,
        campaign: campaignId,
        mechanic: PrizeMechanic.Roulette,
        status: InstantPrizeStatus.Active,
        $expr: { $lt: ['$awardedCount', '$stock'] },
      },
      { $inc: { awardedCount: 1 } },
      { new: true, session },
    );
    expect(orderModel.updateOne).toHaveBeenCalledWith(
      { _id: orderId },
      { $addToSet: { instantPrizes: awardId } },
      { session },
    );
  });

  it('falla cerrado si se altera el snapshot o la entropía comprometida', async () => {
    const token = 'attempt-secret-token-1234567890123';
    const campaignId = new Types.ObjectId();
    const orderId = new Types.ObjectId();
    const base = {
      _id: new Types.ObjectId(),
      publicId: 'tampered-attempt',
      campaign: campaignId,
      order: orderId,
      status: PrizeAttemptStatus.Pending,
      mechanic: PrizeMechanic.Roulette,
      accessSecret: sha256(token),
      entropyReveal: 'original-entropy',
    };
    const attempt = committedAttempt(base, {
      version: 1,
      mechanic: PrizeMechanic.Roulette,
      noPrizeWeight: 1,
      prizes: [],
    });
    attempt.configurationSnapshot.noPrizeWeight = 2;
    attemptModel.findOne.mockReturnValue(executable(attempt));
    orderModel.findById.mockReturnValue(
      executable({
        _id: orderId,
        campaign: campaignId,
        status: OrderStatus.Paid,
      }),
    );

    await expect(service.playAttempt(base.publicId, token)).rejects.toThrow(
      'La configuración comprometida del intento no es válida',
    );
    expect(attempt.save).not.toHaveBeenCalled();
    expect(prizeModel.findOneAndUpdate).not.toHaveBeenCalled();

    const entropyAttempt = committedAttempt(
      { ...base, publicId: 'tampered-entropy' },
      {
        version: 1,
        mechanic: PrizeMechanic.Roulette,
        noPrizeWeight: 1,
        prizes: [],
      },
    );
    entropyAttempt.entropyReveal = 'changed-after-commitment';
    attemptModel.findOne.mockReturnValue(executable(entropyAttempt));
    await expect(
      service.playAttempt('tampered-entropy', token),
    ).rejects.toThrow('El compromiso de entropía del intento no es válido');
    expect(entropyAttempt.save).not.toHaveBeenCalled();
  });

  it('no sobreasigna si el premio elegido se agotó antes del incremento atómico', async () => {
    const token = 'attempt-secret-token-1234567890123';
    const campaignId = new Types.ObjectId();
    const orderId = new Types.ObjectId();
    const prizeId = new Types.ObjectId();
    const attempt = committedAttempt(
      {
        _id: new Types.ObjectId(),
        publicId: 'depleted-attempt',
        campaign: campaignId,
        order: orderId,
        status: PrizeAttemptStatus.Pending,
        mechanic: PrizeMechanic.Roulette,
        accessSecret: sha256(token),
        entropyReveal: 'depleted-entropy',
      },
      {
        version: 1,
        mechanic: PrizeMechanic.Roulette,
        noPrizeWeight: 0,
        prizes: [
          {
            prizeId: prizeId.toString(),
            weight: 1,
            stock: 1,
            sortOrder: 0,
          },
        ],
      },
    );
    attemptModel.findOne.mockReturnValue(executable(attempt));
    orderModel.findById.mockReturnValue(
      executable({
        _id: orderId,
        campaign: campaignId,
        status: OrderStatus.Paid,
      }),
    );
    prizeModel.findOneAndUpdate.mockResolvedValue(null);

    const result = await service.playAttempt('depleted-attempt', token);

    expect(result.won).toBe(false);
    expect(attempt.status).toBe(PrizeAttemptStatus.Played);
    expect(attempt.drawnPrize).toEqual(prizeId);
    expect(attempt.outcome).toBe(PrizeAttemptOutcome.InventoryExhausted);
    expect(awardModel).not.toHaveBeenCalled();
    expect(prizeModel.findOneAndUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        _id: prizeId,
        status: InstantPrizeStatus.Active,
        $expr: { $lt: ['$awardedCount', '$stock'] },
      }),
      { $inc: { awardedCount: 1 } },
      { new: true, session },
    );
  });

  it('oculta snapshot, entropía y secreto mientras el intento está pendiente', () => {
    const attempt = committedAttempt(
      {
        publicId: 'pending-attempt',
        status: PrizeAttemptStatus.Pending,
        mechanic: PrizeMechanic.Roulette,
        accessSecret: sha256('secret'),
        entropyReveal: 'hidden-entropy',
      },
      {
        version: 1,
        mechanic: PrizeMechanic.Roulette,
        noPrizeWeight: 0,
        prizes: [],
      },
    );

    const view = (service as any).attemptView(attempt);

    expect(view.configurationHash).toMatch(/^[a-f0-9]{64}$/);
    expect(view.entropyCommitment).toMatch(/^[a-f0-9]{64}$/);
    expect(view.configurationSnapshot).toBeUndefined();
    expect(view.entropyReveal).toBeUndefined();
    expect(view.accessSecret).toBeUndefined();
  });

  it('no permite jugar un intento después del reembolso del pedido', async () => {
    const campaignId = new Types.ObjectId();
    const orderId = new Types.ObjectId();
    const token = 'attempt-secret-token-1234567890123';
    attemptModel.findOne.mockReturnValue(
      executable(
        document({
          _id: new Types.ObjectId(),
          publicId: 'refunded-attempt',
          campaign: campaignId,
          order: orderId,
          status: PrizeAttemptStatus.Pending,
          mechanic: PrizeMechanic.Roulette,
          accessSecret: createHash('sha256').update(token).digest('hex'),
        }),
      ),
    );
    orderModel.findById.mockReturnValue(
      executable({
        _id: orderId,
        campaign: campaignId,
        status: OrderStatus.Refunded,
      }),
    );

    await expect(
      service.playAttempt('refunded-attempt', token),
    ).rejects.toThrow(
      'El intento solo puede jugarse mientras el pedido esté pagado',
    );
    expect(prizeModel.find).not.toHaveBeenCalled();
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
    const orderId = new Types.ObjectId();
    const award = document({
      publicId: 'award-public-id',
      user: userId,
      order: orderId,
      status: PrizeAwardStatus.Awarded,
    });
    awardModel.findOne.mockReturnValue(executable(award));
    orderModel.findOne.mockReturnValue(
      executable({ _id: orderId, user: userId }),
    );
    orderModel.findById.mockReturnValue(
      executable({ _id: orderId, status: OrderStatus.Paid }),
    );

    const claimed = await service.claimAsUser(
      'award-public-id',
      userId.toString(),
    );
    await service.claimAsUser('award-public-id', userId.toString());

    expect(claimed.status).toBe(PrizeAwardStatus.Claimed);
    expect(claimed.claimedAt).toBeInstanceOf(Date);
    expect(award.save).toHaveBeenCalledTimes(1);
    expect(orderModel.updateOne).toHaveBeenCalledWith(
      { _id: orderId, status: OrderStatus.Paid },
      { $inc: { prizeLifecycleVersion: 1 } },
      { session },
    );

    award.status = PrizeAwardStatus.Awarded;
    await expect(
      service.fulfill(
        'award-public-id',
        { reference: 'ENTREGA-001' },
        new Types.ObjectId().toString(),
      ),
    ).rejects.toThrow('El premio debe estar reclamado antes de entregarse');
  });

  it('persiste actor, referencia y notas al entregar dentro de la transacción', async () => {
    const actorId = new Types.ObjectId();
    const orderId = new Types.ObjectId();
    const award = document({
      publicId: 'fulfilled-award',
      order: orderId,
      status: PrizeAwardStatus.Claimed,
    });
    awardModel.findOne.mockReturnValue(executable(award));
    orderModel.findById.mockReturnValue(
      executable({ _id: orderId, status: OrderStatus.Paid }),
    );

    const fulfilled = await service.fulfill(
      'fulfilled-award',
      {
        reference: '  TRACKING-123  ',
        notes: '  Recibido por el ganador  ',
      },
      actorId.toString(),
    );

    expect(fulfilled).toBe(award);
    expect(award).toEqual(
      expect.objectContaining({
        status: PrizeAwardStatus.Fulfilled,
        fulfilledAt: expect.any(Date),
        fulfilledBy: actorId,
        fulfillmentReference: 'TRACKING-123',
        fulfillmentNotes: 'Recibido por el ganador',
      }),
    );
    expect(award.save).toHaveBeenCalledWith({ session });
    expect(session.withTransaction).toHaveBeenCalledTimes(1);
  });

  it('serializa la reclamación con el pedido y la rechaza después del reembolso', async () => {
    const userId = new Types.ObjectId();
    const orderId = new Types.ObjectId();
    const award = document({
      publicId: 'refunded-award',
      user: userId,
      order: orderId,
      status: PrizeAwardStatus.Awarded,
    });
    awardModel.findOne.mockReturnValue(executable(award));
    orderModel.findOne.mockReturnValue(
      executable({ _id: orderId, user: userId }),
    );
    orderModel.findById.mockReturnValue(
      executable({ _id: orderId, status: OrderStatus.Refunded }),
    );

    await expect(
      service.claimAsUser('refunded-award', userId.toString()),
    ).rejects.toThrow(
      'El premio solo puede procesarse mientras el pedido esté pagado',
    );
    expect(orderModel.updateOne).not.toHaveBeenCalled();
    expect(award.save).not.toHaveBeenCalled();
  });

  it('autoriza el pedido antes de listar sus premios e intentos usando su ID interno', async () => {
    const orderId = new Types.ObjectId();
    orders.findOwnedForCheckout.mockResolvedValue({ _id: orderId });
    awardModel.find.mockReturnValue(leanable([]));
    attemptModel.find.mockReturnValue(executable([]));

    await service.listAwardsForOrder('order-public-id', 'order-token');
    await service.listAttemptsForOrder('order-public-id', 'order-token');

    expect(orders.findOwnedForCheckout).toHaveBeenCalledTimes(2);
    expect(orders.findOwnedForCheckout).toHaveBeenCalledWith(
      'order-public-id',
      'order-token',
      undefined,
    );
    expect(awardModel.find).toHaveBeenCalledWith(
      expect.objectContaining({ order: orderId }),
    );
    expect(attemptModel.find).toHaveBeenCalledWith({ order: orderId });
  });

  it('rechaza reclamar premios de otro usuario o de otro pedido', async () => {
    const award = document({
      publicId: 'award-public-id',
      user: new Types.ObjectId(),
      order: new Types.ObjectId(),
      status: PrizeAwardStatus.Awarded,
    });
    awardModel.findOne.mockReturnValue(executable(award));
    orderModel.findOne.mockReturnValue(executable(null));
    await expect(
      service.claimAsUser('award-public-id', new Types.ObjectId().toString()),
    ).rejects.toBeInstanceOf(ForbiddenException);

    orders.findOwnedForCheckout.mockResolvedValue({
      _id: new Types.ObjectId(),
    });
    await expect(
      service.claimWithOrderToken(
        'award-public-id',
        'order-public-id',
        'token',
      ),
    ).rejects.toThrow('El premio no pertenece a este pedido');
    expect(orders.findOwnedForCheckout).toHaveBeenCalledWith(
      'order-public-id',
      'token',
      undefined,
    );
  });

  it('reconoce premios de invitado vinculados por la propiedad actual del pedido', async () => {
    const userId = new Types.ObjectId();
    const orderId = new Types.ObjectId();
    const award = document({
      publicId: 'guest-award-linked-later',
      order: orderId,
      status: PrizeAwardStatus.Awarded,
    });
    awardModel.findOne.mockReturnValue(executable(award));
    orderModel.findOne.mockReturnValue(
      executable({ _id: orderId, user: userId }),
    );
    orderModel.findById.mockReturnValue(
      executable({ _id: orderId, user: userId, status: OrderStatus.Paid }),
    );

    await expect(
      service.claimAsUser(award.publicId, userId.toString()),
    ).resolves.toEqual(expect.objectContaining({ status: 'claimed' }));

    const distinctQuery = executable([orderId]);
    orderModel.distinct.mockReturnValue(distinctQuery);
    awardModel.find.mockReturnValue(leanable([award]));
    await service.listMine(userId.toString());
    expect(orderModel.distinct).toHaveBeenCalledWith('_id', { user: userId });
    expect(awardModel.find).toHaveBeenCalledWith({
      order: { $in: [orderId] },
      status: { $ne: PrizeAwardStatus.Reversed },
    });
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
    expect(attemptModel.updateMany).toHaveBeenCalledWith(
      { order: orderId, status: PrizeAttemptStatus.Pending },
      { $set: { status: PrizeAttemptStatus.Expired } },
      { session },
    );
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
