import { ForbiddenException } from '@nestjs/common';
import { createHash } from 'crypto';
import { Types } from 'mongoose';
import { OrderAccessService } from './order-access.service';
import { OrdersService } from './orders.service';
import { OrderStatus } from './schemas/order.schema';

function executable<T>(value: T) {
  const query: Record<string, jest.Mock> = {
    exec: jest.fn().mockResolvedValue(value),
  };
  for (const method of [
    'select',
    'populate',
    'sort',
    'limit',
    'lean',
    'session',
  ]) {
    query[method] = jest.fn().mockReturnValue(query);
  }
  return query;
}

function document(payload: Record<string, any>) {
  const item: Record<string, any> = {
    ...payload,
    save: jest.fn(),
  };
  item.save.mockResolvedValue(item);
  item.toObject = jest.fn(() => {
    const raw = { ...item };
    delete raw.save;
    delete raw.toObject;
    return raw;
  });
  return item;
}

describe('OrderAccessService', () => {
  const hmacSecret = 'a'.repeat(48);
  const buyer = {
    name: 'Maria da Silva',
    phone: '+5511999999999',
    email: 'maria@example.com',
    cpf: '52998224725',
  };

  let challengeModel: Record<string, jest.Mock>;
  let orderModel: Record<string, jest.Mock>;
  let email: Record<string, jest.Mock>;
  let session: Record<string, jest.Mock>;
  let connection: Record<string, jest.Mock>;
  let orders: OrdersService;
  let service: OrderAccessService;
  let activeChallenge: Record<string, any> | null;
  let createdChallenges: Array<Record<string, any>>;

  beforeEach(() => {
    activeChallenge = null;
    createdChallenges = [];
    challengeModel = {
      create: jest.fn().mockImplementation(async (payload) => {
        activeChallenge = document({
          ...payload,
          _id: new Types.ObjectId(),
        });
        createdChallenges.push(activeChallenge);
        return activeChallenge;
      }),
      findOne: jest.fn().mockImplementation(() => executable(activeChallenge)),
      deleteOne: jest.fn().mockResolvedValue({ deletedCount: 1 }),
    };
    orderModel = {
      find: jest.fn(),
      findOne: jest.fn(),
      countDocuments: jest.fn(),
    };
    email = {
      sendVerificationEmail: jest.fn().mockResolvedValue(undefined),
    };
    session = {
      withTransaction: jest.fn(async (work: () => Promise<void>) => work()),
      endSession: jest.fn().mockResolvedValue(undefined),
    };
    connection = {
      startSession: jest.fn().mockResolvedValue(session),
    };
    orders = new OrdersService(
      orderModel as any,
      {} as any,
      {} as any,
      connection as any,
      {} as any,
    );
    service = new OrderAccessService(
      challengeModel as any,
      orderModel as any,
      connection as any,
      email as any,
      {
        get: jest.fn((name: string) => {
          if (name === 'CHECKOUT_ACCESS_SECRET_KEY') return hmacSecret;
          if (name === 'ORDER_ACCESS_MAX_ORDERS') return '20';
          return undefined;
        }),
      } as any,
      orders,
    );
  });

  it('envía el OTP y rota transaccionalmente tokens que autorizan cada pedido', async () => {
    const orderIds = [new Types.ObjectId(), new Types.ObjectId()];
    const recoveredOrders = orderIds.map((id, index) =>
      document({
        _id: id,
        publicId: `pedido-${index + 1}`,
        buyer,
        status: OrderStatus.Paid,
        quotas: [{ number: String(index + 1).padStart(4, '0') }],
        titleNumbers: [],
        accessSecret: createHash('sha256')
          .update(`token-antiguo-${index}`)
          .digest('hex'),
      }),
    );
    orderModel.find
      .mockReturnValueOnce(executable(orderIds.map((_id) => ({ _id }))))
      .mockReturnValueOnce(executable(recoveredOrders));

    const challenge = await service.request({
      phone: '+55 (11) 99999-9999',
      email: ' MARIA@EXAMPLE.COM ',
    });
    const code = email.sendVerificationEmail.mock.calls[0][1];
    const result = await service.confirm({
      challengeId: challenge.challengeId,
      code,
    });

    expect(orderModel.find.mock.calls[0][0]).toEqual({
      'buyer.phone': buyer.phone,
      'buyer.email': buyer.email,
      $or: [{ user: { $exists: false } }, { user: null }],
    });
    expect(email.sendVerificationEmail).toHaveBeenCalledWith(
      buyer.email,
      expect.stringMatching(/^\d{6}$/),
    );
    expect(challengeModel.deleteOne).toHaveBeenCalledWith(
      expect.objectContaining({ _id: activeChallenge?._id }),
      { session },
    );
    expect(result.orders).toHaveLength(2);

    for (let index = 0; index < recoveredOrders.length; index += 1) {
      const returned = result.orders[index] as Record<string, any>;
      const recoveredOrder = recoveredOrders[index];
      expect(recoveredOrder.save).toHaveBeenCalledWith({ session });
      expect(recoveredOrder.accessSecret).toBe(
        createHash('sha256').update(returned.accessToken).digest('hex'),
      );
      expect(returned).not.toHaveProperty('accessSecret');
      expect(returned).not.toHaveProperty('_id');

      orderModel.findOne.mockReturnValue(executable(recoveredOrder));
      await expect(
        orders.findByPublicId(returned.id, returned.accessToken),
      ).resolves.toEqual(expect.objectContaining({ id: returned.id }));
      await expect(
        orders.findByPublicId(returned.id, `token-antiguo-${index}`),
      ).rejects.toBeInstanceOf(ForbiddenException);
    }
    expect(session.endSession).toHaveBeenCalledTimes(1);
  });

  it('responde igual sin coincidencias, no envía correo y no guarda PII', async () => {
    orderModel.find.mockReturnValue(executable([]));

    const response = await service.request({
      phone: '+55 11 98888-7777',
      email: 'nadie@example.com',
      campaignId: new Types.ObjectId().toString(),
    });

    expect(response).toEqual({
      challengeId: expect.stringMatching(/^[A-Za-z0-9_-]{32}$/),
      expiresInSeconds: 900,
      message:
        'Si los datos coinciden, enviaremos un código al correo indicado.',
    });
    expect(email.sendVerificationEmail).not.toHaveBeenCalled();
    expect(createdChallenges[0]).toEqual(
      expect.objectContaining({
        codeHash: expect.stringMatching(/^[a-f0-9]{64}$/),
        orderIds: [],
        attempts: 0,
      }),
    );
    expect(createdChallenges[0]).not.toHaveProperty('email');
    expect(createdChallenges[0]).not.toHaveProperty('phone');
    expect(orderModel.find.mock.calls[0][0]).toEqual(
      expect.objectContaining({
        campaign: expect.any(Types.ObjectId),
      }),
    );
  });

  it('cuenta hasta cinco códigos inválidos y después bloquea el challenge', async () => {
    const orderId = new Types.ObjectId();
    orderModel.find.mockReturnValue(executable([{ _id: orderId }]));
    const challenge = await service.request({
      phone: buyer.phone,
      email: buyer.email,
    });
    const validCode = email.sendVerificationEmail.mock.calls[0][1];

    for (let attempt = 1; attempt <= 5; attempt += 1) {
      await expect(
        service.confirm({
          challengeId: challenge.challengeId,
          code: validCode === '000000' ? '999999' : '000000',
        }),
      ).rejects.toThrow('Código inválido o expirado');
      expect(activeChallenge?.attempts).toBe(attempt);
    }

    await expect(
      service.confirm({ challengeId: challenge.challengeId, code: validCode }),
    ).rejects.toThrow('Código inválido o expirado');
    expect(activeChallenge?.save).toHaveBeenCalledTimes(5);
    expect(challengeModel.deleteOne).not.toHaveBeenCalled();
  });

  it('invalida el challenge después del primer uso correcto', async () => {
    const orderId = new Types.ObjectId();
    const recoveredOrder = document({
      _id: orderId,
      publicId: 'pedido-unico',
      buyer,
      status: OrderStatus.Paid,
      accessSecret: createHash('sha256').update('anterior').digest('hex'),
    });
    orderModel.find
      .mockReturnValueOnce(executable([{ _id: orderId }]))
      .mockReturnValueOnce(executable([recoveredOrder]));
    const challenge = await service.request({
      phone: buyer.phone,
      email: buyer.email,
    });
    const code = email.sendVerificationEmail.mock.calls[0][1];

    await expect(
      service.confirm({ challengeId: challenge.challengeId, code }),
    ).resolves.toEqual({
      orders: [expect.objectContaining({ accessToken: expect.any(String) })],
    });

    activeChallenge = null;
    await expect(
      service.confirm({ challengeId: challenge.challengeId, code }),
    ).rejects.toThrow('Código inválido o expirado');
    expect(recoveredOrder.save).toHaveBeenCalledTimes(1);
  });
});
