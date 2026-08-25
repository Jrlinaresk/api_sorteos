import { Types } from 'mongoose';
import { createHash } from 'crypto';
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

  it('redacta evidencia cruda y metadata del PSP en la vista administrativa', () => {
    const service = new PaymentsService({} as any, {} as any, {} as any);
    const view = service.toAdminView({
      toObject: () => ({
        _id: new Types.ObjectId(),
        status: PaymentStatus.Paid,
        publicSecretHash: 'hash-secreto',
        providerPayload: { devedor: { cpf: '52998224725' } },
        webhookPayloads: [{ payload: { chave: 'pix-secreta' } }],
        statusHistory: [
          {
            status: PaymentStatus.Paid,
            metadata: { payer: 'Maria', cpf: '52998224725' },
          },
        ],
        refunds: [
          {
            amount: 10,
            providerPayload: { cpf: '52998224725' },
          },
        ],
      }),
    } as never);

    const serialized = JSON.stringify(view);
    expect(serialized).not.toContain('52998224725');
    expect(serialized).not.toContain('pix-secreta');
    expect(serialized).not.toContain('hash-secreto');
    expect(view.statusHistory).toEqual([{ status: PaymentStatus.Paid }]);
    expect(view.refunds).toEqual([{ amount: 10 }]);
  });

  it('caduca el secreto público de pago según su emisión', async () => {
    const paymentId = new Types.ObjectId();
    const secret = 'guest-payment-access-secret';
    const payment = {
      _id: paymentId,
      publicSecretHash: createHash('sha256').update(secret).digest('hex'),
      status: PaymentStatus.Active,
      provider: PaymentProviderName.Mock,
      txid: '12345678901234567890123456789012',
      amount: 10,
      currency: PaymentCurrency.BRL,
      expiresAt: new Date(Date.now() + 60_000),
      createdAt: new Date(Date.now() - 2 * 60 * 60_000),
      updatedAt: new Date(),
    };
    const query = {
      select: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue(payment),
    };
    const paymentModel = {
      findById: jest.fn().mockReturnValue(query),
    };
    const config = {
      get: jest.fn((name: string) =>
        name === 'PAYMENT_ACCESS_TOKEN_HOURS' ? '1' : undefined,
      ),
    };
    const service = new PaymentsService(
      paymentModel as any,
      {} as any,
      config as any,
    );

    await expect(
      service.findPublic(paymentId.toString(), secret),
    ).rejects.toThrow('Pago o secreto de acceso inválido');

    payment.createdAt = new Date();
    await expect(
      service.findPublic(paymentId.toString(), secret),
    ).resolves.toEqual(
      expect.objectContaining({ id: paymentId.toString(), amount: 10 }),
    );
  });
});
