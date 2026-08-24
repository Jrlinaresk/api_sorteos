import { ConflictException } from '@nestjs/common';
import { Types } from 'mongoose';
import { PaymentCurrency, PaymentProviderName, PaymentStatus } from './payment.enums';
import { PaymentsService } from './payments.service';
import { PrizeAwardStatus } from '../prizes/schemas/prize-award.schema';

function query<T>(value: T) {
  const chain: Record<string, jest.Mock> = {
    exec: jest.fn().mockResolvedValue(value),
    lean: jest.fn().mockResolvedValue(value),
  };
  chain.select = jest.fn().mockReturnValue(chain);
  return chain;
}

function payment() {
  return {
    _id: new Types.ObjectId(),
    order: new Types.ObjectId(),
    campaign: new Types.ObjectId(),
    provider: PaymentProviderName.Mock,
    status: PaymentStatus.Paid,
    amount: 10,
    currency: PaymentCurrency.BRL,
    txid: '12345678901234567890123456789012',
    endToEndId: 'E123',
    refundedAmount: 0,
    refunds: [],
    statusHistory: [],
    save: jest.fn().mockResolvedValue(undefined),
  };
}

describe('PaymentsService refund policy', () => {
  it('bloquea la devolución en el proveedor si ya se entregó un premio', async () => {
    const stored = payment();
    const provider = { refundPayment: jest.fn() };
    const paymentModel = {
      findById: jest.fn().mockReturnValue(query(stored)),
      updateOne: jest.fn(),
    };
    const orderModel = {
      findById: jest.fn().mockReturnValue(query({ titleNumbers: ['000001'] })),
    };
    const campaignModel = {
      findById: jest.fn().mockReturnValue(query({ status: 'active' })),
    };
    const awardModel = {
      findOne: jest.fn().mockReturnValue(
        query({ _id: new Types.ObjectId(), status: PrizeAwardStatus.Fulfilled }),
      ),
    };
    const service = new PaymentsService(
      paymentModel as never,
      { get: jest.fn().mockReturnValue(provider) } as never,
      { get: jest.fn() } as never,
      orderModel as never,
      campaignModel as never,
      awardModel as never,
    );

    await expect(
      service.refund(stored._id.toString(), {
        idempotencyKey: 'refund:fulfilled:1',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(provider.refundPayment).not.toHaveBeenCalled();
  });

  it('permite reintentar callbacks de un pago sin volver a aplicar la política de devolución', async () => {
    const stored = payment();
    const paymentModel = {
      findById: jest.fn().mockReturnValue(query(stored)),
      updateOne: jest.fn().mockResolvedValue({ modifiedCount: 1 }),
    };
    const orderModel = { findById: jest.fn() };
    const campaignModel = { findById: jest.fn() };
    const awardModel = { findOne: jest.fn() };
    const service = new PaymentsService(
      paymentModel as never,
      { get: jest.fn() } as never,
      { get: jest.fn() } as never,
      orderModel as never,
      campaignModel as never,
      awardModel as never,
    );
    const onPaymentPaid = jest.fn();
    service.registerLifecycleHooks({ onPaymentPaid });

    await expect(
      service.retryLifecycleHooks(stored._id.toString()),
    ).resolves.toBe(stored);

    expect(onPaymentPaid).toHaveBeenCalledTimes(1);
    expect(orderModel.findById).not.toHaveBeenCalled();
    expect(campaignModel.findById).not.toHaveBeenCalled();
    expect(awardModel.findOne).not.toHaveBeenCalled();
  });
});
