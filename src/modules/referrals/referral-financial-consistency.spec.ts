import { Types } from 'mongoose';
import { ReferralAttributionService } from './referral-attribution.service';
import { ReferralsService } from './referrals.service';
import { ReferralCommissionStatus } from './schemas/referral-commission.schema';
import { ReferralCodeStatus } from './schemas/referral-code.schema';

function query<T>(value: T) {
  const result = {
    session: jest.fn(),
    exec: jest.fn().mockResolvedValue(value),
  };
  result.session.mockReturnValue(result);
  return result;
}

function transactionHarness() {
  const session = {
    withTransaction: jest.fn(async (work: () => Promise<void>) => work()),
    endSession: jest.fn().mockResolvedValue(undefined),
  };
  return {
    session,
    connection: {
      startSession: jest.fn().mockResolvedValue(session),
    },
  };
}

describe('Referral conversion release consistency', () => {
  it('atribuye contador, comisión y click en la misma transacción', async () => {
    const referralCode = new Types.ObjectId();
    const clickId = new Types.ObjectId();
    const code = {
      _id: referralCode,
      id: referralCode.toString(),
      code: 'SOCIO1',
      status: ReferralCodeStatus.Active,
      commissionRateBps: 500,
      currency: 'BRL',
      conversionsCount: 0,
    };
    const click = {
      _id: clickId,
      code: code.code,
      referralCode,
    };
    const commission = {
      _id: new Types.ObjectId(),
      orderId: 'order-atomic',
    };
    const commissionModel = {
      findOne: jest.fn(() => query(null)),
      create: jest.fn().mockResolvedValue([commission]),
    };
    const clickModel = {
      findById: jest.fn(() => query(click)),
      updateOne: jest.fn(() => query({ matchedCount: 1 })),
    };
    const codeModel = {
      findOne: jest.fn(() => query(code)),
      findOneAndUpdate: jest.fn(() => query({ ...code, conversionsCount: 1 })),
    };
    const { connection, session } = transactionHarness();
    const service = new ReferralAttributionService(
      codeModel as never,
      clickModel as never,
      commissionModel as never,
      undefined,
      connection as never,
    );

    await expect(
      service.attributeOrder({
        orderId: 'order-atomic',
        referralCode: code.code,
        clickId: clickId.toString(),
        orderAmount: 100,
        currency: 'BRL',
      }),
    ).resolves.toBe(commission);

    expect(codeModel.findOneAndUpdate).toHaveBeenCalledWith(
      expect.any(Object),
      { $inc: { conversionsCount: 1 } },
      { new: true, session },
    );
    expect(commissionModel.create).toHaveBeenCalledWith(
      [expect.objectContaining({ orderId: 'order-atomic' })],
      { session },
    );
    expect(clickModel.updateOne).toHaveBeenCalledWith(
      expect.objectContaining({ _id: clickId }),
      expect.any(Object),
      { session },
    );
    expect(session.endSession).toHaveBeenCalled();
  });

  it('libera una sola vez al revertir administrativamente', async () => {
    const commissionId = new Types.ObjectId();
    const referralCode = new Types.ObjectId();
    let current: Record<string, any> = {
      _id: commissionId,
      referralCode,
      status: ReferralCommissionStatus.Approved,
    };
    const commissionModel = {
      findById: jest.fn(() => query(current)),
      findOneAndUpdate: jest.fn(
        (_filter: unknown, update: { $set: Record<string, unknown> }) => {
          current = { ...current, ...update.$set };
          return query(current);
        },
      ),
    };
    const codeModel = {
      updateOne: jest.fn(() => query({ modifiedCount: 1 })),
    };
    const { connection, session } = transactionHarness();
    const service = new ReferralsService(
      codeModel as never,
      {} as never,
      commissionModel as never,
      connection as never,
    );

    await service.updateCommissionStatus(commissionId.toString(), {
      status: ReferralCommissionStatus.Reversed,
      reason: 'Reembolso confirmado',
    });
    await service.updateCommissionStatus(commissionId.toString(), {
      status: ReferralCommissionStatus.Reversed,
      reason: 'Replay idempotente',
    });

    expect(codeModel.updateOne).toHaveBeenCalledTimes(1);
    expect(codeModel.updateOne).toHaveBeenCalledWith(
      { _id: referralCode, conversionsCount: { $gt: 0 } },
      { $inc: { conversionsCount: -1 } },
      { session },
    );
    expect(current.conversionReleasedAt).toBeInstanceOf(Date);
  });

  it('serializa la reversión automática y no duplica el decremento', async () => {
    const referralCode = new Types.ObjectId();
    let current: Record<string, any> = {
      _id: new Types.ObjectId(),
      referralCode,
      status: ReferralCommissionStatus.Pending,
    };
    const commissionModel = {
      findOne: jest.fn(() => query(current)),
      findOneAndUpdate: jest.fn(
        (_filter: unknown, update: { $set: Record<string, unknown> }) => {
          current = { ...current, ...update.$set };
          return query(current);
        },
      ),
    };
    const codeModel = {
      updateOne: jest.fn(() => query({ modifiedCount: 1 })),
    };
    const { connection, session } = transactionHarness();
    const service = new ReferralAttributionService(
      codeModel as never,
      {} as never,
      commissionModel as never,
      undefined,
      connection as never,
    );

    await service.reverseOrder('order-1', 'Pedido reembolsado');
    await service.reverseOrder('order-1', 'Replay del outbox');

    expect(codeModel.updateOne).toHaveBeenCalledTimes(1);
    expect(codeModel.updateOne).toHaveBeenCalledWith(
      { _id: referralCode, conversionsCount: { $gt: 0 } },
      { $inc: { conversionsCount: -1 } },
      { session },
    );
    expect(current.status).toBe(ReferralCommissionStatus.Reversed);
    expect(current.conversionReleasedAt).toBeInstanceOf(Date);
  });
});
