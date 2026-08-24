import { Types } from 'mongoose';
import {
  PaymentCurrency,
  PaymentProviderName,
  PaymentStatus,
} from './payment.enums';
import { PaymentsService } from './payments.service';

describe('PaymentsService provider creation', () => {
  it('actually creates a provider charge for a new guest payment', async () => {
    const provider = {
      name: PaymentProviderName.Mock,
      createPayment: jest.fn().mockResolvedValue({
        externalId: 'mock-external-id',
        txid: '12345678901234567890123456789012',
        status: PaymentStatus.Active,
        qrCode: 'mock://qr',
        pixCopyPaste: 'PIX-COPY-PASTE',
      }),
      findPayment: jest.fn(),
      cancelPayment: jest.fn(),
      refundPayment: jest.fn(),
    };
    const paymentModel = {
      findOne: jest
        .fn()
        .mockReturnValue({ exec: jest.fn().mockResolvedValue(null) }),
      create: jest.fn().mockImplementation(async (data) => ({
        ...data,
        _id: new Types.ObjectId(),
        refundedAmount: 0,
        webhookPayloads: [],
        refunds: [],
        save: jest.fn().mockResolvedValue(undefined),
        toObject: jest.fn().mockReturnValue(data),
      })),
      updateOne: jest.fn().mockResolvedValue({ modifiedCount: 1 }),
    };
    const providerFactory = { get: jest.fn().mockReturnValue(provider) };
    const config = {
      get: jest.fn((name: string) =>
        name === 'PAYMENTS_PUBLIC_SECRET_KEY' ? 'unit-test-secret' : undefined,
      ),
    };
    const service = new PaymentsService(
      paymentModel as any,
      providerFactory as any,
      config as any,
    );

    const result = await service.create({
      orderId: new Types.ObjectId().toString(),
      campaignId: new Types.ObjectId().toString(),
      amount: 34.99,
      currency: PaymentCurrency.BRL,
      idempotencyKey: 'checkout:66c123456789012345678901',
      expiresInSeconds: 900,
      payer: { name: 'Maria da Silva', cpf: '52998224725' },
    });

    expect(provider.createPayment).toHaveBeenCalledWith(
      expect.objectContaining({
        amount: 34.99,
        currency: PaymentCurrency.BRL,
        idempotencyKey: 'checkout:66c123456789012345678901',
      }),
    );
    expect(result.payment.status).toBe(PaymentStatus.Active);
    expect(result.payment.pixCopyPaste).toBe('PIX-COPY-PASTE');
    expect(paymentModel.create).toHaveBeenCalledWith(
      expect.not.objectContaining({ user: expect.anything() }),
    );
  });
});
