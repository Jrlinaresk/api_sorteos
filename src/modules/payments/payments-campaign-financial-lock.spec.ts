import { Types } from 'mongoose';
import {
  PaymentCurrency,
  PaymentProviderName,
  PaymentStatus,
} from './payment.enums';
import { PaymentsService } from './payments.service';

function query<T>(value: T) {
  const chain: Record<string, jest.Mock> = {
    exec: jest.fn().mockResolvedValue(value),
  };
  chain.session = jest.fn().mockReturnValue(chain);
  chain.select = jest.fn().mockReturnValue(chain);
  return chain;
}

describe('PaymentsService campaign financial serialization', () => {
  it('toca la versión de campaña dentro de la transición Pix transaccional', async () => {
    const session = {
      withTransaction: jest.fn(async (work: () => Promise<void>) => work()),
      endSession: jest.fn().mockResolvedValue(undefined),
    };
    const payment: Record<string, any> = {
      _id: new Types.ObjectId(),
      order: new Types.ObjectId(),
      campaign: new Types.ObjectId(),
      provider: PaymentProviderName.Efi,
      status: PaymentStatus.Active,
      amount: 10,
      amountCents: 1_000,
      receivedAmountCents: 0,
      refundedAmount: 0,
      refundedAmountCents: 0,
      refundReservedAmountCents: 0,
      currency: PaymentCurrency.BRL,
      txid: '12345678901234567890123456789012',
      expiresAt: new Date(Date.now() + 60_000),
      receipts: [],
      providerRefunds: [],
      endToEndIds: [],
      refunds: [],
      webhookPayloads: [],
      statusHistory: [],
      transitionSequence: 0,
      save: jest.fn(),
    };
    payment.save.mockImplementation(async () => payment);
    const paymentModel = {
      findOne: jest.fn().mockReturnValue(query(payment)),
      findById: jest.fn().mockReturnValue(query(payment)),
      updateOne: jest.fn().mockResolvedValue({ modifiedCount: 1 }),
    };
    const campaignModel = {
      updateOne: jest
        .fn()
        .mockResolvedValue({ matchedCount: 1, modifiedCount: 1 }),
    };
    const outboxModel = { create: jest.fn().mockResolvedValue([]) };
    const service = new PaymentsService(
      paymentModel as never,
      { get: jest.fn().mockReturnValue({}) } as never,
      { get: jest.fn() } as never,
      undefined,
      campaignModel as never,
      undefined,
      {
        startSession: jest.fn().mockResolvedValue(session),
      } as never,
      outboxModel as never,
    );

    await service.processWebhook(PaymentProviderName.Efi, {
      pix: [
        {
          txid: payment.txid,
          endToEndId: 'E1234567890123456789012345678901',
          valor: '4.00',
          horario: '2026-08-24T12:00:00.000Z',
        },
      ],
    });

    expect(payment.status).toBe(PaymentStatus.UnderReview);
    expect(campaignModel.updateOne).toHaveBeenCalledWith(
      { _id: payment.campaign },
      { $inc: { __v: 1 } },
      { session },
    );
    expect(campaignModel.updateOne.mock.invocationCallOrder[0]).toBeLessThan(
      payment.save.mock.invocationCallOrder[0],
    );
  });
});
