import { ConflictException } from '@nestjs/common';
import { Types } from 'mongoose';
import { DrawResultStatus } from '../draws/schemas/draw-result.schema';
import { QuotaStatus } from '../orders/schemas/quota.schema';
import { MainPrizeAwardsService } from './main-prize-awards.service';
import {
  MainPrizeAwardStatus,
  MainPrizeChoice,
  MainPrizeClaimSource,
} from './schemas/main-prize-award.schema';

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

function awardDocument(overrides: Record<string, unknown> = {}) {
  const raw: Record<string, any> = {
    _id: new Types.ObjectId(),
    publicId: '5be9e3fe-bb54-4ae5-a8ca-bacb7c614111',
    campaign: new Types.ObjectId(),
    drawResult: new Types.ObjectId(),
    quota: new Types.ObjectId(),
    order: new Types.ObjectId(),
    orderPublicId: 'order-public-123',
    prizeTitle: 'Honda Titan 160',
    cashAlternative: 15_000,
    currency: 'BRL',
    winningNumber: '001234',
    winnerSnapshot: {
      name: 'Maria da Silva',
      phone: '+5511999999999',
      email: 'maria@example.com',
    },
    status: MainPrizeAwardStatus.Pending,
    awardedAt: new Date('2026-08-24T12:00:00.000Z'),
    notificationAttempts: 1,
    notificationNextAttemptAt: new Date(),
    notificationLeaseToken: 'lease-1',
    ...overrides,
  };
  raw.toObject = jest.fn(() => {
    const copy = { ...raw };
    delete copy.toObject;
    return copy;
  });
  return raw;
}

describe('MainPrizeAwardsService', () => {
  let awardModel: Record<string, jest.Mock>;
  let orderModel: Record<string, jest.Mock>;
  let quotaModel: Record<string, jest.Mock>;
  let orders: Record<string, jest.Mock>;
  let notifications: Record<string, jest.Mock>;
  let email: Record<string, jest.Mock>;
  let service: MainPrizeAwardsService;

  beforeEach(() => {
    awardModel = {
      findOne: jest.fn(),
      findOneAndUpdate: jest.fn(),
      findById: jest.fn(),
      create: jest.fn(),
      updateOne: jest.fn().mockResolvedValue({ modifiedCount: 1 }),
      exists: jest.fn().mockResolvedValue(null),
      find: jest.fn(),
      countDocuments: jest.fn(),
    };
    orderModel = { findOne: jest.fn(), distinct: jest.fn() };
    quotaModel = { findOne: jest.fn() };
    orders = { findOwnedForCheckout: jest.fn() };
    notifications = { create: jest.fn().mockResolvedValue({}) };
    email = { enqueueAndDeliver: jest.fn().mockResolvedValue(undefined) };
    service = new MainPrizeAwardsService(
      awardModel as never,
      orderModel as never,
      quotaModel as never,
      orders as never,
      notifications as never,
      email as never,
    );
  });

  it('crea dentro de la publicación un contrato único con snapshots del pedido', async () => {
    const campaignId = new Types.ObjectId();
    const resultId = new Types.ObjectId();
    const quotaId = new Types.ObjectId();
    const orderId = new Types.ObjectId();
    const userId = new Types.ObjectId();
    const session = {} as never;
    const quota = { _id: quotaId, status: QuotaStatus.Paid };
    const order = {
      _id: orderId,
      publicId: 'order-public-123',
      user: userId,
      buyer: {
        name: 'Maria da Silva',
        phone: '+5511999999999',
        email: 'maria@example.com',
      },
    };
    quotaModel.findOne.mockReturnValue(queryResult(quota));
    orderModel.findOne.mockReturnValue(queryResult(order));
    awardModel.findOne.mockReturnValue(queryResult(null));
    const created = awardDocument({
      campaign: campaignId,
      drawResult: resultId,
      quota: quotaId,
      order: orderId,
      user: userId,
    });
    awardModel.create.mockResolvedValue([created]);

    const result = await service.ensureForPublishedResult(
      {
        _id: resultId,
        status: DrawResultStatus.Published,
        publishedAt: new Date('2026-08-24T12:00:00.000Z'),
        outcomes: [
          {
            position: 1,
            prizeTitle: 'Honda Titan 160',
            winningNumber: '001234',
            quota: quotaId,
            order: orderId,
            user: userId,
          },
        ],
      } as never,
      {
        _id: campaignId,
        prizeTitle: 'Honda Titan 160',
        cashAlternative: 15_000,
        currency: 'BRL',
      } as never,
      session,
    );

    expect(result).toBe(created);
    expect(awardModel.create).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          campaign: campaignId,
          drawResult: resultId,
          quota: quotaId,
          order: orderId,
          user: userId,
          orderPublicId: 'order-public-123',
          cashAlternative: 15_000,
          winnerSnapshot: order.buyer,
          status: MainPrizeAwardStatus.Pending,
        }),
      ],
      { session },
    );
  });

  it('reutiliza idempotentemente el contrato si campaña, resultado, cuota y pedido coinciden', async () => {
    const existing = awardDocument();
    quotaModel.findOne.mockReturnValue(
      queryResult({ _id: existing.quota, status: QuotaStatus.Paid }),
    );
    orderModel.findOne.mockReturnValue(
      queryResult({
        _id: existing.order,
        publicId: existing.orderPublicId,
        buyer: existing.winnerSnapshot,
      }),
    );
    awardModel.findOne.mockReturnValue(queryResult(existing));

    const returned = await service.ensureForPublishedResult(
      {
        _id: existing.drawResult,
        status: DrawResultStatus.Published,
        outcomes: [
          {
            quota: existing.quota,
            order: existing.order,
            winningNumber: existing.winningNumber,
          },
        ],
      } as never,
      {
        _id: existing.campaign,
        prizeTitle: existing.prizeTitle,
        cashAlternative: existing.cashAlternative,
        currency: 'BRL',
      } as never,
      {} as never,
    );

    expect(returned).toBe(existing);
    expect(awardModel.create).not.toHaveBeenCalled();
  });

  it('envía al invitado correo durable sin crear una notificación de usuario', async () => {
    const award = awardDocument();
    awardModel.findOneAndUpdate.mockReturnValue(queryResult(award));

    await expect(service.tryNotifyAward(award._id)).resolves.toBe(true);

    expect(notifications.create).not.toHaveBeenCalled();
    expect(email.enqueueAndDeliver).toHaveBeenCalledWith(
      expect.objectContaining({
        eventKey: `main-award:${award.publicId}:email`,
        recipient: 'maria@example.com',
      }),
    );
    expect(awardModel.updateOne).toHaveBeenCalledWith(
      expect.objectContaining({ _id: award._id }),
      expect.objectContaining({
        $set: expect.objectContaining({
          notificationCompletedAt: expect.any(Date),
        }),
      }),
    );
  });

  it('envía al registrado inbox idempotente y correo de respaldo', async () => {
    const userId = new Types.ObjectId();
    const award = awardDocument({ user: userId });
    awardModel.findOneAndUpdate.mockReturnValue(queryResult(award));

    await service.tryNotifyAward(award._id);

    expect(notifications.create).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: userId.toString(),
        eventKey: `main-award:${award.publicId}:inbox`,
        data: expect.objectContaining({ awardId: award.publicId }),
      }),
    );
    expect(email.enqueueAndDeliver).toHaveBeenCalledWith(
      expect.objectContaining({
        eventKey: `main-award:${award.publicId}:email`,
      }),
    );
  });

  it('conserva el fallo y agenda reparación sin perder el award publicado', async () => {
    const award = awardDocument();
    awardModel.findOneAndUpdate.mockReturnValue(queryResult(award));
    email.enqueueAndDeliver.mockRejectedValue(new Error('SMTP secret detail'));

    await expect(service.tryNotifyAward(award._id)).resolves.toBe(false);

    expect(awardModel.updateOne).toHaveBeenLastCalledWith(
      { _id: award._id, notificationLeaseToken: expect.any(String) },
      expect.objectContaining({
        $set: expect.objectContaining({
          notificationNextAttemptAt: expect.any(Date),
          lastNotificationError: 'Error: notification scheduling failed',
        }),
      }),
    );
  });

  it('autoriza al invitado mediante OrdersService y registra su elección física', async () => {
    const award = awardDocument();
    const delivery = {
      recipientName: 'Maria da Silva',
      phone: '+55 11 99999-9999',
      address: 'Rua das Flores, 123, São Paulo - SP',
      instructions: 'Entregar en portería',
    };
    const claimed = awardDocument({
      ...award,
      status: MainPrizeAwardStatus.Claimed,
      choice: MainPrizeChoice.Physical,
      deliveryDetails: delivery,
      claimSource: MainPrizeClaimSource.OrderToken,
      claimedAt: new Date(),
    });
    awardModel.findOne.mockReturnValue(queryResult(award));
    orders.findOwnedForCheckout.mockResolvedValue({ _id: award.order });
    awardModel.findOneAndUpdate.mockReturnValue(queryResult(claimed));

    const result = await service.claimOwned(
      award.publicId,
      { choice: MainPrizeChoice.Physical, delivery },
      'opaque-order-token',
    );

    expect(orders.findOwnedForCheckout).toHaveBeenCalledWith(
      award.orderPublicId,
      'opaque-order-token',
      undefined,
    );
    expect(result).toEqual(
      expect.objectContaining({
        status: MainPrizeAwardStatus.Claimed,
        choice: MainPrizeChoice.Physical,
        deliveryDetails: delivery,
        claimSource: MainPrizeClaimSource.OrderToken,
      }),
    );
  });

  it('permite descubrir el award desde un pedido propio sin exponerlo públicamente', async () => {
    const award = awardDocument();
    orders.findOwnedForCheckout.mockResolvedValue({ _id: award.order });
    awardModel.findOne.mockReturnValue(queryResult(award));

    const result = await service.findOwnedByOrder(
      award.orderPublicId,
      'opaque-order-token',
    );

    expect(orders.findOwnedForCheckout).toHaveBeenCalledWith(
      award.orderPublicId,
      'opaque-order-token',
      undefined,
    );
    expect(awardModel.findOne).toHaveBeenCalledWith({ order: award.order });
    expect(result).toEqual(
      expect.objectContaining({
        publicId: award.publicId,
        campaignId: award.campaign.toString(),
        availableChoices: [MainPrizeChoice.Physical, MainPrizeChoice.Cash],
      }),
    );
  });

  it('registra reclamo de cuenta y hace idempotente la misma elección', async () => {
    const userId = new Types.ObjectId();
    const claimed = awardDocument({
      user: userId,
      status: MainPrizeAwardStatus.Claimed,
      choice: MainPrizeChoice.Cash,
      claimSource: MainPrizeClaimSource.Account,
      claimedByUser: userId,
      claimedAt: new Date(),
    });
    awardModel.findOne.mockReturnValue(queryResult(claimed));
    orders.findOwnedForCheckout.mockResolvedValue({ _id: claimed.order });

    await expect(
      service.claimOwned(
        claimed.publicId,
        { choice: MainPrizeChoice.Cash },
        undefined,
        userId.toString(),
      ),
    ).resolves.toEqual(
      expect.objectContaining({ choice: MainPrizeChoice.Cash }),
    );
    expect(awardModel.findOneAndUpdate).not.toHaveBeenCalled();

    await expect(
      service.claimOwned(
        claimed.publicId,
        { choice: MainPrizeChoice.Physical },
        undefined,
        userId.toString(),
      ),
    ).rejects.toThrow('ya fue reclamado');
  });

  it('rechaza efectivo si la campaña no publicó una alternativa positiva', async () => {
    const award = awardDocument({ cashAlternative: undefined });
    awardModel.findOne.mockReturnValue(queryResult(award));
    orders.findOwnedForCheckout.mockResolvedValue({ _id: award.order });

    await expect(
      service.claimOwned(
        award.publicId,
        { choice: MainPrizeChoice.Cash },
        'opaque-order-token',
      ),
    ).rejects.toThrow('no ofrece una alternativa válida en efectivo');
  });

  it('exige entrega para físico, rechaza entrega con efectivo y protege la idempotencia', async () => {
    const pending = awardDocument();
    awardModel.findOne.mockReturnValue(queryResult(pending));
    orders.findOwnedForCheckout.mockResolvedValue({ _id: pending.order });

    await expect(
      service.claimOwned(
        pending.publicId,
        { choice: MainPrizeChoice.Physical },
        'order-token',
      ),
    ).rejects.toThrow('datos de entrega son obligatorios');
    await expect(
      service.claimOwned(
        pending.publicId,
        {
          choice: MainPrizeChoice.Cash,
          delivery: {
            recipientName: 'Maria da Silva',
            phone: '+5511999999999',
            address: 'Rua das Flores, 123',
          },
        },
        'order-token',
      ),
    ).rejects.toThrow('solo corresponden al premio físico');

    const claimed = awardDocument({
      status: MainPrizeAwardStatus.Claimed,
      choice: MainPrizeChoice.Physical,
      deliveryDetails: {
        recipientName: 'Maria da Silva',
        phone: '+5511999999999',
        address: 'Rua das Flores, 123',
      },
    });
    awardModel.findOne.mockReturnValue(queryResult(claimed));
    orders.findOwnedForCheckout.mockResolvedValue({ _id: claimed.order });
    await expect(
      service.claimOwned(
        claimed.publicId,
        {
          choice: MainPrizeChoice.Physical,
          delivery: {
            recipientName: 'Outra Pessoa',
            phone: '+5511999999999',
            address: 'Rua das Flores, 123',
          },
        },
        'order-token',
      ),
    ).rejects.toThrow('otros datos de entrega');
  });

  it('lista por la propiedad actual del pedido, no por el snapshot user del award', async () => {
    const userId = new Types.ObjectId();
    const orderId = new Types.ObjectId();
    const award = awardDocument({ order: orderId, user: undefined });
    orderModel.distinct.mockReturnValue(queryResult([orderId]));
    awardModel.find.mockReturnValue(queryResult([award]));
    awardModel.countDocuments.mockReturnValue(queryResult(21));

    const result = await service.listMine(userId.toString(), {
      page: 1,
      limit: 20,
    });

    expect(orderModel.distinct).toHaveBeenCalledWith('_id', { user: userId });
    expect(awardModel.find).toHaveBeenCalledWith({ order: { $in: [orderId] } });
    expect(result.meta).toEqual({
      page: 1,
      limit: 20,
      total: 21,
      pages: 2,
      hasNextPage: true,
    });
  });

  it('conserva el ID y solo el resumen seguro de una campaña poblada', () => {
    const campaignId = new Types.ObjectId();
    const award = awardDocument({
      campaign: {
        _id: campaignId,
        name: 'Titan 160',
        slug: 'titan-160',
        prizeTitle: 'Honda Titan 160',
        currency: 'BRL',
        regulationHtml: '<p>interno</p>',
      },
    });

    const view = (service as any).ownerView(award);

    expect(view.campaignId).toBe(campaignId.toString());
    expect(view.campaign).toEqual({
      id: campaignId.toString(),
      name: 'Titan 160',
      slug: 'titan-160',
      prizeTitle: 'Honda Titan 160',
      currency: 'BRL',
    });
    expect(view.campaign).not.toHaveProperty('regulationHtml');
  });

  it('solo entrega un premio reclamado y conserva actor, fecha y comprobante', async () => {
    const actorId = new Types.ObjectId();
    const claimed = awardDocument({
      status: MainPrizeAwardStatus.Claimed,
      choice: MainPrizeChoice.Cash,
      claimedAt: new Date(),
    });
    const fulfilled = awardDocument({
      ...claimed,
      status: MainPrizeAwardStatus.Fulfilled,
      fulfilledAt: new Date(),
      fulfilledBy: actorId,
      fulfillmentReference: 'PIX-E2E-123',
      fulfillmentNotes: 'Recibo conciliado',
    });
    awardModel.findOne.mockReturnValue(queryResult(claimed));
    awardModel.findOneAndUpdate.mockReturnValue(queryResult(fulfilled));

    const result = await service.fulfill(
      claimed.publicId,
      { reference: ' PIX-E2E-123 ', notes: ' Recibo conciliado ' },
      actorId.toString(),
    );

    expect(awardModel.findOneAndUpdate).toHaveBeenCalledWith(
      { _id: claimed._id, status: MainPrizeAwardStatus.Claimed },
      expect.objectContaining({
        $set: expect.objectContaining({
          status: MainPrizeAwardStatus.Fulfilled,
          fulfilledBy: actorId,
          fulfilledAt: expect.any(Date),
          fulfillmentReference: 'PIX-E2E-123',
        }),
      }),
      { new: true, runValidators: true },
    );
    expect(result).toEqual(
      expect.objectContaining({ status: MainPrizeAwardStatus.Fulfilled }),
    );
  });

  it('no permite fulfill antes del claim', async () => {
    const award = awardDocument({ status: MainPrizeAwardStatus.Pending });
    awardModel.findOne.mockReturnValue(queryResult(award));

    await expect(
      service.fulfill(award.publicId, {}, new Types.ObjectId().toString()),
    ).rejects.toThrow('debe reclamar y elegir');
  });

  it('detecta colisiones entre identidades únicas del premio', async () => {
    const campaignId = new Types.ObjectId();
    const colliding = awardDocument({ campaign: campaignId });
    quotaModel.findOne.mockReturnValue(
      queryResult({ _id: colliding.quota, status: QuotaStatus.Paid }),
    );
    orderModel.findOne.mockReturnValue(
      queryResult({
        _id: colliding.order,
        publicId: colliding.orderPublicId,
        buyer: colliding.winnerSnapshot,
      }),
    );
    awardModel.findOne.mockReturnValue(queryResult(colliding));

    await expect(
      service.ensureForPublishedResult(
        {
          _id: new Types.ObjectId(),
          status: DrawResultStatus.Published,
          outcomes: [
            {
              quota: colliding.quota,
              order: colliding.order,
              winningNumber: '001234',
            },
          ],
        } as never,
        {
          _id: campaignId,
          prizeTitle: 'Titan',
          currency: 'BRL',
        } as never,
        {} as never,
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});
