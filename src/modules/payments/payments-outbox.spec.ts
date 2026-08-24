import { Types } from 'mongoose';
import {
  PaymentCurrency,
  PaymentEventSource,
  PaymentProviderName,
  PaymentStatus,
} from './payment.enums';
import { PaymentsService } from './payments.service';
import { PaymentOutboxStatus } from './schemas/payment-outbox.schema';

function query<T>(value: T) {
  const chain: Record<string, jest.Mock> = {
    exec: jest.fn().mockResolvedValue(value),
  };
  chain.select = jest.fn().mockReturnValue(chain);
  chain.sort = jest.fn().mockReturnValue(chain);
  return chain;
}

describe('PaymentsService lifecycle outbox', () => {
  it('retries a failed durable step through the same queue', async () => {
    const paymentId = new Types.ObjectId();
    const payment = {
      _id: paymentId,
      order: new Types.ObjectId(),
      campaign: new Types.ObjectId(),
      provider: PaymentProviderName.Mock,
      status: PaymentStatus.Paid,
      amount: 10,
      amountCents: 1000,
      currency: PaymentCurrency.BRL,
      txid: '12345678901234567890123456789012',
      transitionSequence: 1,
    };
    const outbox: Record<string, any> = {
      _id: new Types.ObjectId(),
      eventKey: `${paymentId}:1`,
      payment: paymentId,
      sequence: 1,
      orderId: payment.order.toString(),
      campaignId: payment.campaign.toString(),
      provider: payment.provider,
      previousStatus: PaymentStatus.Active,
      status: PaymentStatus.Paid,
      source: PaymentEventSource.Webhook,
      amountCents: 1000,
      currency: PaymentCurrency.BRL,
      txid: payment.txid,
      outboxStatus: PaymentOutboxStatus.Pending,
      completedSteps: [],
      attempts: 0,
      nextAttemptAt: new Date(),
      save: jest.fn().mockResolvedValue(undefined),
    };
    const paymentModel = {
      findById: jest.fn().mockReturnValue(query(payment)),
      updateOne: jest.fn().mockResolvedValue({ modifiedCount: 1 }),
    };
    const applyOutboxUpdate = (update: Record<string, any>) => {
      Object.assign(outbox, update.$set ?? {});
      for (const key of Object.keys(update.$unset ?? {})) delete outbox[key];
    };
    const outboxModel = {
      findOne: jest.fn().mockReturnValue(query(outbox)),
      findOneAndUpdate: jest.fn().mockImplementation(() => {
        const eligible =
          outbox.outboxStatus === PaymentOutboxStatus.Pending &&
          outbox.nextAttemptAt.getTime() <= Date.now();
        if (eligible) {
          outbox.outboxStatus = PaymentOutboxStatus.Processing;
          outbox.lockedAt = new Date();
        }
        return query(eligible ? outbox : null);
      }),
      updateOne: jest.fn().mockImplementation(async (_filter, update) => {
        applyOutboxUpdate(update);
        return { modifiedCount: 1 };
      }),
    };
    const service = new PaymentsService(
      paymentModel as never,
      { get: jest.fn() } as never,
      { get: jest.fn() } as never,
      undefined,
      undefined,
      undefined,
      undefined,
      outboxModel as never,
    );
    const onPaymentPaid = jest
      .fn()
      .mockRejectedValueOnce(new Error('fallo transitorio'))
      .mockResolvedValue(undefined);
    service.registerLifecycleHooks({ onPaymentPaid });

    await service.retryLifecycleHooks(paymentId.toString());
    expect(outbox.outboxStatus).toBe(PaymentOutboxStatus.Pending);
    expect(outbox.lastError).toContain('fallo transitorio');

    await service.retryLifecycleHooks(paymentId.toString());
    expect(outbox.outboxStatus).toBe(PaymentOutboxStatus.Succeeded);
    expect(outbox.completedSteps).toEqual(['Object:onPaymentPaid']);
    expect(onPaymentPaid).toHaveBeenCalledTimes(2);
  });
});
