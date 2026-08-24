import { BadRequestException, ConflictException } from '@nestjs/common';
import { createHash } from 'crypto';
import { Types } from 'mongoose';
import { OrdersService } from './orders.service';
import { OrderStatus } from './schemas/order.schema';
import { QuotaStatus } from './schemas/quota.schema';
import { CampaignStatus, Raffle } from '../riffles/schema/raffle.schema';

function executable<T>(value: T) {
  const query: Record<string, jest.Mock> = {
    exec: jest.fn().mockResolvedValue(value),
  };
  for (const method of [
    'select',
    'populate',
    'sort',
    'skip',
    'limit',
    'session',
    'lean',
  ]) {
    query[method] = jest.fn().mockReturnValue(query);
  }
  return query;
}

function plainDocument(payload: Record<string, any>) {
  const document: Record<string, any> = {
    ...payload,
    save: jest.fn(),
  };
  document.save.mockResolvedValue(document);
  document.toObject = jest.fn(() => {
    const raw = { ...document };
    delete raw.save;
    delete raw.toObject;
    return raw;
  });
  return document;
}

describe('OrdersService reservations and lifecycle', () => {
  let orderModel: jest.Mock & Record<string, jest.Mock>;
  let quotaModel: Record<string, jest.Mock>;
  let campaignModel: Record<string, jest.Mock>;
  let session: Record<string, jest.Mock>;
  let connection: Record<string, jest.Mock>;
  let campaigns: Record<string, jest.Mock>;
  let service: OrdersService;

  const buyer = {
    name: 'Maria da Silva',
    phone: '+5511999999999',
    email: 'maria@example.com',
    cpf: '52998224725',
  };

  beforeEach(() => {
    orderModel = jest.fn() as jest.Mock & Record<string, jest.Mock>;
    quotaModel = {
      find: jest.fn(),
      updateMany: jest.fn(),
      updateOne: jest.fn(),
      insertMany: jest.fn(),
      countDocuments: jest.fn(),
      findOne: jest.fn(),
    };
    campaignModel = {
      findOne: jest.fn(),
      findById: jest.fn(),
    };
    session = {
      withTransaction: jest.fn(async (work: () => Promise<void>) => work()),
      endSession: jest.fn().mockResolvedValue(undefined),
    };
    connection = {
      startSession: jest.fn().mockResolvedValue(session),
    };
    campaigns = { calculatePrice: jest.fn() };
    service = new OrdersService(
      orderModel as any,
      quotaModel as any,
      campaignModel as any,
      connection as any,
      campaigns as any,
    );
  });

  it('reserva de forma atómica cuotas reutilizables y nuevas sin confiar en importes cliente', async () => {
    const campaignId = new Types.ObjectId();
    const reusableId = new Types.ObjectId();
    const campaign = plainDocument({
      _id: campaignId,
      slug: 'titan-160',
      status: CampaignStatus.Active,
      termsVersion: 'v1',
      regulationHtml: '<p onclick="steal()">Reglas</p><script>steal()</script>',
      regulationHistory: [
        {
          version: 'v1',
          html: '<p onclick="steal()">Reglas</p><script>steal()</script>',
          sha256: 'legacy-source-hash',
        },
      ],
      totalTitles: 10,
      quotaDigits: 2,
      allocationMultiplier: 3,
      allocationOffset: 1,
      allocationCursor: 4,
      soldCount: 2,
      reservedCount: 1,
    });
    const quote = {
      selectedQuantity: 2,
      bonusQuantity: 1,
      allocatedQuantity: 3,
      unitPrice: 1,
      subtotal: 2,
      discount: 0.5,
      total: 1.5,
      currency: 'BRL',
      doubleChanceMultiplier: 1,
    };
    campaigns.calculatePrice.mockReturnValue(quote);
    campaignModel.findOne.mockReturnValue(executable(campaign));
    const reusable = { _id: reusableId, isBonus: false };
    quotaModel.find.mockReturnValue(executable([reusable]));
    quotaModel.updateMany.mockResolvedValue({ modifiedCount: 1 });
    const insertedIds = [new Types.ObjectId(), new Types.ObjectId()];
    quotaModel.insertMany.mockImplementation(
      async (documents: Array<Record<string, unknown>>) =>
        documents.map((document, index) => ({
          ...document,
          _id: insertedIds[index],
        })),
    );
    orderModel.mockImplementation((payload: Record<string, unknown>) =>
      plainDocument({
        ...payload,
        _id: new Types.ObjectId(),
        publicId: 'order-public-id',
        quotas: [],
      }),
    );

    const result = await service.createReservation({
      campaignSlug: ' TITAN-160 ',
      quantity: 2,
      buyer: {
        ...buyer,
        name: '  Maria   da Silva ',
        email: 'MARIA@EXAMPLE.COM ',
      },
      termsVersion: 'v1',
    });

    expect(campaigns.calculatePrice).toHaveBeenCalledWith(campaign, 2);
    expect(orderModel).toHaveBeenCalledWith(
      expect.objectContaining({
        buyer,
        total: 1.5,
        currency: 'BRL',
        allocatedQuantity: 3,
        termsHash: createHash('sha256').update('<p>Reglas</p>').digest('hex'),
      }),
    );
    expect(quotaModel.updateMany).toHaveBeenCalledWith(
      { _id: { $in: [reusableId] }, status: QuotaStatus.Available },
      expect.objectContaining({
        $set: expect.objectContaining({ status: QuotaStatus.Reserved }),
      }),
      { session },
    );
    expect(quotaModel.insertMany).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          allocationIndex: 4,
          number: '03',
          isBonus: false,
        }),
        expect.objectContaining({
          allocationIndex: 5,
          number: '06',
          isBonus: true,
        }),
      ],
      { session, ordered: true },
    );
    expect(campaign.allocationCursor).toBe(6);
    expect(campaign.reservedCount).toBe(4);
    expect(result).toEqual(
      expect.objectContaining({
        id: 'order-public-id',
        accessToken: expect.any(String),
        paymentRequired: true,
        quotas: [reusableId, ...insertedIds],
      }),
    );
    expect(session.endSession).toHaveBeenCalledTimes(1);
  });

  it('reproduce una reserva idempotente sin abrir otra transacción', async () => {
    const input = {
      campaignSlug: 'titan-160',
      quantity: 10,
      buyer,
      termsVersion: 'v1',
      idempotencyKey: 'client-operation-1',
    };
    const replayToken = (service as any).createAccessToken(input);
    const previous = plainDocument({
      _id: new Types.ObjectId(),
      publicId: 'same-order',
      campaign: { _id: new Types.ObjectId(), slug: 'titan-160' },
      selectedQuantity: 10,
      buyer,
      termsVersion: 'v1',
      status: OrderStatus.Reserved,
      accessSecret: (service as any).hashSecret(replayToken),
    });
    orderModel.findOne = jest.fn().mockReturnValue(executable(previous));

    const first = await service.createReservation(input);
    const second = await service.createReservation(input);

    expect(connection.startSession).not.toHaveBeenCalled();
    expect(previous.save).not.toHaveBeenCalled();
    expect(first.accessToken).toBe(second.accessToken);
    expect(first.id).toBe('same-order');
  });

  it('no restaura el token anterior después de una recuperación de pedido', async () => {
    const previous = plainDocument({
      _id: new Types.ObjectId(),
      publicId: 'recovered-order',
      campaign: { _id: new Types.ObjectId(), slug: 'titan-160' },
      selectedQuantity: 10,
      buyer,
      termsVersion: 'v1',
      status: OrderStatus.Paid,
      accessSecret: 'a'.repeat(64),
    });
    orderModel.findOne = jest.fn().mockReturnValue(executable(previous));

    await expect(
      service.createReservation({
        campaignSlug: 'titan-160',
        quantity: 10,
        buyer,
        termsVersion: 'v1',
        idempotencyKey: 'client-operation-1',
      }),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'ORDER_ACCESS_ROTATED' }),
    });
    expect(previous.save).not.toHaveBeenCalled();
  });

  it('no permite que otra cuenta reclame un replay idempotente', async () => {
    const previous = plainDocument({
      _id: new Types.ObjectId(),
      publicId: 'owned-order',
      user: new Types.ObjectId(),
      campaign: { _id: new Types.ObjectId(), slug: 'titan-160' },
      selectedQuantity: 10,
      buyer,
      termsVersion: 'v1',
      status: OrderStatus.Paid,
      accessSecret: 'a'.repeat(64),
    });
    orderModel.findOne = jest.fn().mockReturnValue(executable(previous));

    await expect(
      service.createReservation(
        {
          campaignSlug: 'titan-160',
          quantity: 10,
          buyer,
          termsVersion: 'v1',
          idempotencyKey: 'client-operation-1',
        },
        new Types.ObjectId().toString(),
      ),
    ).rejects.toThrow(
      'La clave idempotente ya pertenece a otro contexto de comprador',
    );
  });

  it('limita la cantidad realmente asignada aunque existan bonos', () => {
    const previous = process.env.ORDER_MAX_ALLOCATED_TITLES;
    process.env.ORDER_MAX_ALLOCATED_TITLES = '2000';
    try {
      expect(() => (service as any).assertAllocationSize(2_001)).toThrow(
        BadRequestException,
      );
      expect(() => (service as any).assertAllocationSize(2_000)).not.toThrow();
    } finally {
      if (previous === undefined) delete process.env.ORDER_MAX_ALLOCATED_TITLES;
      else process.env.ORDER_MAX_ALLOCATED_TITLES = previous;
    }
  });

  it('rechaza reutilizar una idempotency key con otra cantidad', async () => {
    const previous = plainDocument({
      campaign: { slug: 'titan-160' },
      selectedQuantity: 9,
      buyer,
      termsVersion: 'v1',
      status: OrderStatus.Reserved,
    });
    orderModel.findOne = jest.fn().mockReturnValue(executable(previous));

    await expect(
      service.createReservation({
        campaignSlug: 'titan-160',
        quantity: 10,
        buyer,
        termsVersion: 'v1',
        idempotencyKey: 'client-operation-1',
      }),
    ).rejects.toThrow(
      'La clave idempotente ya se utilizó con otros datos de checkout',
    );
  });

  it('produce una permutación determinista, completa y con padding', () => {
    const campaign = {
      totalTitles: 10,
      quotaDigits: 2,
      allocationMultiplier: 3,
      allocationOffset: 7,
    } as Raffle;
    const values = Array.from({ length: 10 }, (_, index) =>
      (service as any).numberForIndex(campaign, index),
    );

    expect(values).toEqual([
      '07',
      '00',
      '03',
      '06',
      '09',
      '02',
      '05',
      '08',
      '01',
      '04',
    ]);
    expect(new Set(values).size).toBe(campaign.totalTitles);
  });

  it('confirma pago, mueve cuotas y actualiza contadores en una transacción', async () => {
    const paymentId = new Types.ObjectId();
    const campaignId = new Types.ObjectId();
    const paidAt = new Date('2026-08-25T12:00:00.000Z');
    const order = plainDocument({
      _id: new Types.ObjectId(),
      campaign: campaignId,
      status: OrderStatus.PendingPayment,
      allocatedQuantity: 2,
      statusHistory: [],
    });
    const campaign = plainDocument({
      _id: campaignId,
      reservedCount: 2,
      soldCount: 8,
      totalTitles: 10,
      status: CampaignStatus.Active,
    });
    orderModel.findOne = jest.fn().mockReturnValue(executable(order));
    quotaModel.updateMany.mockResolvedValue({ modifiedCount: 2 });
    campaignModel.findById.mockReturnValue(executable(campaign));

    const result = await service.markPaidByPayment(paymentId, paidAt);

    expect(quotaModel.updateMany).toHaveBeenCalledWith(
      { order: order._id, status: QuotaStatus.Reserved },
      {
        $set: { status: QuotaStatus.Paid, paidAt },
        $unset: { reservedUntil: 1 },
      },
      { session },
    );
    expect(campaign.reservedCount).toBe(0);
    expect(campaign.soldCount).toBe(10);
    expect(campaign.status).toBe(CampaignStatus.SoldOut);
    expect(campaign.salesClosedAt).toBe(paidAt);
    expect(order.status).toBe(OrderStatus.Paid);
    expect(order.paidAt).toBe(paidAt);
    expect(result).toBe(order);
  });

  it('no duplica una confirmación ya pagada y detecta reservas parciales', async () => {
    const paid = plainDocument({
      _id: new Types.ObjectId(),
      status: OrderStatus.Paid,
      allocatedQuantity: 2,
      statusHistory: [],
    });
    orderModel.findOne = jest.fn().mockReturnValueOnce(executable(paid));
    await expect(service.markPaidByPayment(new Types.ObjectId())).resolves.toBe(
      paid,
    );
    expect(quotaModel.updateMany).not.toHaveBeenCalled();

    const incomplete = plainDocument({
      _id: new Types.ObjectId(),
      status: OrderStatus.PendingPayment,
      allocatedQuantity: 2,
      statusHistory: [],
    });
    orderModel.findOne.mockReturnValueOnce(executable(incomplete));
    quotaModel.updateMany.mockResolvedValueOnce({ modifiedCount: 1 });
    await expect(
      service.markPaidByPayment(new Types.ObjectId()),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(session.endSession).toHaveBeenCalledTimes(2);
  });

  it.each([
    {
      label: 'reabre ventas si las ventanas siguen vigentes',
      closesAt: new Date(Date.now() + 60 * 60_000),
      drawDate: new Date(Date.now() + 2 * 60 * 60_000),
      expected: CampaignStatus.Active,
    },
    {
      label: 'queda vencida si ya no existe una ventana de venta segura',
      closesAt: new Date(Date.now() - 60_000),
      drawDate: new Date(Date.now() + 60 * 60_000),
      expected: CampaignStatus.Expired,
    },
  ])(
    'un reembolso desde awaiting_draw $label',
    async ({ closesAt, drawDate, expected }) => {
      const paymentId = new Types.ObjectId();
      const campaignId = new Types.ObjectId();
      const order = plainDocument({
        _id: new Types.ObjectId(),
        campaign: campaignId,
        status: OrderStatus.Paid,
        allocatedQuantity: 2,
        titleNumbers: ['01', '02'],
        statusHistory: [],
      });
      const campaign = plainDocument({
        _id: campaignId,
        status: CampaignStatus.AwaitingDraw,
        soldCount: 10,
        reservedCount: 0,
        totalTitles: 10,
        closesAt,
        drawDate,
        salesClosedAt: new Date(),
      });
      orderModel.findOne = jest.fn().mockReturnValue(executable(order));
      campaignModel.findById.mockReturnValue(executable(campaign));
      quotaModel.updateMany.mockResolvedValue({ modifiedCount: 2 });

      const result = await service.markRefundedByPayment(
        paymentId,
        'devolución administrativa',
      );

      expect(campaign.soldCount).toBe(8);
      expect(campaign.status).toBe(expected);
      expect(campaign.salesClosedAt).toBeUndefined();
      expect(order.status).toBe(OrderStatus.Refunded);
      expect(result).toBe(order);
      expect(campaign.save).toHaveBeenCalledWith({ session });
      expect(order.save).toHaveBeenCalledWith({ session });
    },
  );

  it.each([
    [OrderStatus.Expired, false],
    [OrderStatus.Cancelled, true],
  ])(
    'libera cuotas y reabre una campaña sold_out al pasar a %s',
    async (status, cancelled) => {
      const campaignId = new Types.ObjectId();
      const order = plainDocument({
        _id: new Types.ObjectId(),
        campaign: campaignId,
        status: OrderStatus.PendingPayment,
        allocatedQuantity: 3,
        statusHistory: [],
      });
      const campaign = plainDocument({
        _id: campaignId,
        reservedCount: 3,
        soldCount: 7,
        totalTitles: 10,
        status: CampaignStatus.SoldOut,
      });
      orderModel.findById = jest.fn().mockReturnValue(executable(order));
      campaignModel.findById.mockReturnValue(executable(campaign));
      const assignedQuery: Record<string, jest.Mock> = {
        select: jest.fn(),
        session: jest.fn(),
        lean: jest
          .fn()
          .mockResolvedValue([
            { number: '000001' },
            { number: '000002' },
            { number: '000003' },
          ]),
      };
      assignedQuery.select.mockReturnValue(assignedQuery);
      assignedQuery.session.mockReturnValue(assignedQuery);
      quotaModel.find.mockReturnValue(assignedQuery);
      quotaModel.updateMany.mockResolvedValue({ modifiedCount: 3 });

      await service.cancelByIdSystem(
        order._id,
        status as any,
        'fin de reserva',
      );

      expect(quotaModel.updateMany).toHaveBeenCalledWith(
        { order: order._id, status: QuotaStatus.Reserved },
        {
          $set: { status: QuotaStatus.Available, isBonus: false },
          $unset: { order: 1, user: 1, reservedUntil: 1, unitPrice: 1 },
        },
        { session },
      );
      expect(campaign.reservedCount).toBe(0);
      expect(campaign.status).toBe(CampaignStatus.Active);
      expect(order.status).toBe(status);
      expect(order.titleNumbers).toEqual(['000001', '000002', '000003']);
      expect(Boolean(order.cancelledAt)).toBe(cancelled);
    },
  );

  it('procesa en lote las expiradas y aísla el fallo de una reserva', async () => {
    const expired = [
      { _id: new Types.ObjectId() },
      { _id: new Types.ObjectId() },
    ];
    const query: Record<string, jest.Mock> = {
      select: jest.fn(),
      limit: jest.fn(),
      lean: jest.fn().mockResolvedValue(expired),
    };
    query.select.mockReturnValue(query);
    query.limit.mockReturnValue(query);
    orderModel.find = jest.fn().mockReturnValue(query);
    const release = jest
      .spyOn(service as any, 'releaseReservation')
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('concurrent update'));

    await expect(service.releaseExpiredReservations()).resolves.toBe(2);
    expect(orderModel.find).toHaveBeenCalledWith(
      expect.objectContaining({
        status: {
          $in: [OrderStatus.Reserved, OrderStatus.PendingPayment],
        },
      }),
    );
    expect(release).toHaveBeenNthCalledWith(
      1,
      expired[0]._id,
      OrderStatus.Expired,
      'Reserva vencida',
    );
    expect(release).toHaveBeenCalledTimes(2);
  });

  it('valida CPF antes de abrir una sesión de base de datos', async () => {
    await expect(
      service.createReservation({
        campaignSlug: 'titan-160',
        quantity: 1,
        buyer: { ...buyer, cpf: '11111111111' },
        termsVersion: 'v1',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(connection.startSession).not.toHaveBeenCalled();
  });
});

describe('OrdersService titles and CSV exports', () => {
  let orderModel: Record<string, jest.Mock>;
  let quotaModel: Record<string, jest.Mock>;
  let campaignModel: Record<string, jest.Mock>;
  let service: OrdersService;

  beforeEach(() => {
    orderModel = {};
    quotaModel = { find: jest.fn(), countDocuments: jest.fn() };
    campaignModel = { findById: jest.fn() };
    service = new OrdersService(
      orderModel as any,
      quotaModel as any,
      campaignModel as any,
      { startSession: jest.fn() } as any,
      {} as any,
    );
  });

  function quotaCursor(rows: Array<Record<string, unknown>>) {
    const query: Record<string, jest.Mock> = {};
    for (const method of ['select', 'populate', 'sort', 'lean']) {
      query[method] = jest.fn().mockReturnValue(query);
    }
    query.cursor = jest.fn(() => ({
      async *[Symbol.asyncIterator]() {
        for (const row of rows) yield row;
      },
    }));
    return query;
  }

  async function read(stream: NodeJS.ReadableStream) {
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(Buffer.from(chunk));
    return Buffer.concat(chunks).toString('utf8');
  }

  it('consulta únicamente títulos pagados/adjudicados del dueño', async () => {
    const userId = new Types.ObjectId().toString();
    const campaignId = new Types.ObjectId().toString();
    const query = executable([{ number: '000123' }]);
    query.lean.mockReturnValue(query);
    quotaModel.find.mockReturnValue(query);
    quotaModel.countDocuments.mockReturnValue(executable(1));

    await expect(
      service.getMyTitles(userId, {
        campaignId,
        page: 2,
        limit: 50,
      }),
    ).resolves.toEqual({
      data: [{ number: '000123' }],
      meta: { page: 2, limit: 50, total: 1, pages: 1 },
    });

    expect(quotaModel.find).toHaveBeenCalledWith({
      user: new Types.ObjectId(userId),
      campaign: new Types.ObjectId(campaignId),
      status: { $in: [QuotaStatus.Paid, QuotaStatus.Awarded] },
    });
    expect(query.select).toHaveBeenCalledWith(
      'number status isBonus instantPrize paidAt campaign order',
    );
    expect(query.skip).toHaveBeenCalledWith(50);
    expect(query.limit).toHaveBeenCalledWith(50);
  });

  it('exporta CSV administrativo completo, con BOM, comillas y neutralización de fórmulas', async () => {
    const campaignId = new Types.ObjectId().toString();
    campaignModel.findById.mockReturnValue({
      lean: jest
        .fn()
        .mockResolvedValue({ _id: new Types.ObjectId(campaignId) }),
    });
    quotaModel.find.mockReturnValue(
      quotaCursor([
        {
          number: '000001',
          status: QuotaStatus.Paid,
          isBonus: false,
          paidAt: new Date('2026-08-25T12:00:00.000Z'),
          order: {
            publicId: 'order-1',
            buyer: {
              name: '=2+2',
              phone: '+5511999999999',
              email: 'maria,"promo"@example.com',
              cpf: '-52998224725',
            },
          },
        },
      ]),
    );

    const csv = await read(await service.participantsCsv(campaignId, true));

    expect(csv.startsWith('\uFEFFtitulo,status')).toBe(true);
    expect(csv).toContain("'=2+2");
    expect(csv).toContain("'-52998224725");
    expect(csv).toContain('"maria,""promo""@example.com"');
    expect(csv).toContain('+5511999999999');
    expect(csv).toContain('2026-08-25T12:00:00.000Z');
  });

  it('exporta CSV público enmascarado y omite email, CPF y pedido', async () => {
    const campaignId = new Types.ObjectId().toString();
    campaignModel.findById.mockReturnValue({
      lean: jest.fn().mockResolvedValue({
        _id: new Types.ObjectId(campaignId),
        status: CampaignStatus.Active,
        modules: { showParticipantsDownload: true },
      }),
    });
    quotaModel.find.mockReturnValue(
      quotaCursor([
        {
          number: '000001',
          status: QuotaStatus.Awarded,
          isBonus: true,
          order: {
            publicId: 'secret-order',
            buyer: {
              name: 'Maria da Silva',
              phone: '+5511999999999',
              email: 'secret@example.com',
              cpf: '52998224725',
            },
          },
        },
      ]),
    );

    const csv = await read(await service.participantsCsv(campaignId));

    expect(csv).toContain('titulo,status,bonus,nombre,telefono,pagado_en');
    expect(csv).toContain('Maria d. S.');
    expect(csv).not.toContain('secret@example.com');
    expect(csv).not.toContain('52998224725');
    expect(csv).not.toContain('secret-order');
    expect(csv).not.toContain('+5511999999999');
  });
});
