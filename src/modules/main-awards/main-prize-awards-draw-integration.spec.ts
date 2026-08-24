import { Types } from 'mongoose';
import { DrawsService } from '../draws/draws.service';
import { DrawResultStatus } from '../draws/schemas/draw-result.schema';
import { OrderStatus } from '../orders/schemas/order.schema';
import { QuotaStatus } from '../orders/schemas/quota.schema';
import { PaymentStatus } from '../payments/payment.enums';
import { CampaignStatus } from '../riffles/schema/raffle.schema';

function queryResult<T>(value: T) {
  const query: Record<string, jest.Mock> = {
    exec: jest.fn().mockResolvedValue(value),
  };
  for (const method of ['session', 'select', 'lean']) {
    query[method] = jest.fn().mockReturnValue(query);
  }
  return query;
}

function document(payload: Record<string, unknown>) {
  const value: Record<string, any> = {
    ...payload,
    save: jest.fn(),
  };
  value.save.mockResolvedValue(value);
  value.toObject = jest.fn(() => {
    const raw = { ...value };
    delete raw.save;
    delete raw.toObject;
    return raw;
  });
  return value;
}

describe('DrawsService + contrato del premio principal', () => {
  it('crea el award en la transacción de publicación y avisa después del commit', async () => {
    const campaignId = new Types.ObjectId();
    const actorId = new Types.ObjectId();
    const userId = new Types.ObjectId();
    const quotaId = new Types.ObjectId();
    const orderId = new Types.ObjectId();
    const paymentId = new Types.ObjectId();
    const result = document({
      _id: new Types.ObjectId(),
      campaign: campaignId,
      status: DrawResultStatus.Verified,
      verifiedBy: new Types.ObjectId(),
      outcomes: [
        {
          position: 1,
          prizeTitle: 'Honda Titan 160',
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
    const resultModel = { findOne: jest.fn(() => queryResult(result)) };
    const campaignModel = {
      findById: jest.fn(() => queryResult(campaign)),
    };
    const quotaModel = {
      findOne: jest.fn(() =>
        queryResult({
          _id: quotaId,
          campaign: campaignId,
          number: '001234',
          order: orderId,
          user: userId,
          status: QuotaStatus.Paid,
        }),
      ),
      updateOne: jest.fn().mockResolvedValue({ matchedCount: 1 }),
    };
    const orderModel = {
      findOne: jest.fn(() => queryResult(null)),
      aggregate: jest.fn(() => queryResult([])),
      findById: jest.fn(() =>
        queryResult({
          _id: orderId,
          campaign: campaignId,
          payment: paymentId,
          status: OrderStatus.Paid,
        }),
      ),
      updateOne: jest.fn().mockResolvedValue({ matchedCount: 1 }),
    };
    const paymentModel = {
      findOne: jest.fn(() => queryResult(null)),
      findById: jest.fn(() =>
        queryResult({
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
      updateOne: jest.fn().mockResolvedValue({ matchedCount: 1 }),
    };
    const refundOperationModel = {
      aggregate: jest.fn(() => queryResult([])),
      findOne: jest.fn(() => queryResult(null)),
    };
    const session = {
      withTransaction: jest.fn(async (work: () => Promise<void>) => work()),
      endSession: jest.fn().mockResolvedValue(undefined),
    };
    const awardId = new Types.ObjectId();
    const mainAwards = {
      ensureForPublishedResult: jest.fn().mockResolvedValue({ _id: awardId }),
      tryNotifyAward: jest.fn().mockResolvedValue(true),
    };
    const service = new DrawsService(
      resultModel as never,
      campaignModel as never,
      quotaModel as never,
      orderModel as never,
      paymentModel as never,
      refundOperationModel as never,
      { startSession: jest.fn().mockResolvedValue(session) } as never,
      { create: jest.fn() } as never,
      {} as never,
      {} as never,
      { get: jest.fn() } as never,
      mainAwards as never,
    );

    await service.publish(campaignId.toString(), actorId.toString());

    expect(mainAwards.ensureForPublishedResult).toHaveBeenCalledWith(
      result,
      campaign,
      session,
    );
    expect(mainAwards.tryNotifyAward).toHaveBeenCalledWith(awardId.toString());
    expect(result.save).toHaveBeenCalledWith({ session });
    expect(session.endSession).toHaveBeenCalled();
  });
});
