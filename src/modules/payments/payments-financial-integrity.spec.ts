import { Types } from 'mongoose';
import {
  PaymentCurrency,
  PaymentProviderName,
  PaymentStatus,
} from './payment.enums';
import { PaymentsService } from './payments.service';
import { OrderStatus } from '../orders/schemas/order.schema';

function query<T>(value: T) {
  const chain: Record<string, jest.Mock> = {
    exec: jest.fn().mockResolvedValue(value),
  };
  chain.select = jest.fn().mockReturnValue(chain);
  chain.session = jest.fn().mockReturnValue(chain);
  return chain;
}

function payment(status = PaymentStatus.Active) {
  const value: Record<string, any> = {
    _id: new Types.ObjectId(),
    order: new Types.ObjectId(),
    campaign: new Types.ObjectId(),
    provider: PaymentProviderName.Efi,
    status,
    amount: 10,
    amountCents: 1000,
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
  value.save.mockImplementation(async () => value);
  return value;
}

function serviceFor(stored: Record<string, any>, orderModel?: object) {
  const paymentModel = {
    findOne: jest.fn().mockReturnValue(query(stored)),
    findById: jest.fn().mockReturnValue(query(stored)),
    updateOne: jest.fn().mockResolvedValue({ modifiedCount: 1 }),
  };
  const service = new PaymentsService(
    paymentModel as never,
    { get: jest.fn().mockReturnValue({}) } as never,
    { get: jest.fn() } as never,
    orderModel as never,
  );
  return { service, paymentModel };
}

function pix(
  txid: string,
  endToEndId: string,
  valor: string,
  horario = '2026-08-24T12:00:00.000Z',
) {
  return { txid, endToEndId, valor, horario };
}

describe('PaymentsService Pix financial integrity', () => {
  it('keeps a partial receipt under review and never fulfills it', async () => {
    const stored = payment();
    const { service } = serviceFor(stored);
    const onPaymentPaid = jest.fn();
    service.registerLifecycleHooks({ onPaymentPaid });

    await service.processWebhook(PaymentProviderName.Efi, {
      pix: [pix(stored.txid, 'E-PARTIAL', '4.00')],
    });

    expect(stored.status).toBe(PaymentStatus.UnderReview);
    expect(stored.receivedAmountCents).toBe(400);
    expect(onPaymentPaid).not.toHaveBeenCalled();
  });

  it('keeps an overpayment under review and preserves the received total', async () => {
    const stored = payment();
    const { service } = serviceFor(stored);

    await service.processWebhook(PaymentProviderName.Efi, {
      pix: [pix(stored.txid, 'E-OVERPAY', '11.00')],
    });

    expect(stored.status).toBe(PaymentStatus.UnderReview);
    expect(stored.receivedAmountCents).toBe(1100);
  });

  it('deduplicates repeated receipts by endToEndId before comparing cents', async () => {
    const stored = payment();
    const { service } = serviceFor(stored);
    const onPaymentPaid = jest.fn();
    service.registerLifecycleHooks({ onPaymentPaid });
    const receipt = pix(stored.txid, 'E-DUPLICATE', '10.00');

    await service.processWebhook(PaymentProviderName.Efi, {
      pix: [receipt, { ...receipt }],
    });

    expect(stored.status).toBe(PaymentStatus.Paid);
    expect(stored.receipts).toHaveLength(1);
    expect(stored.receivedAmountCents).toBe(1000);
    expect(onPaymentPaid).toHaveBeenCalledTimes(1);
  });

  it('routes a late exact Pix to review when the order was already expired', async () => {
    const stored = payment(PaymentStatus.Expired);
    const orderModel = {
      findById: jest.fn().mockReturnValue(
        query({
          _id: stored.order,
          status: OrderStatus.Expired,
          expiresAt: new Date(Date.now() - 60_000),
        }),
      ),
    };
    const { service } = serviceFor(stored, orderModel);
    const onPaymentPaid = jest.fn();
    service.registerLifecycleHooks({ onPaymentPaid });

    await service.processWebhook(PaymentProviderName.Efi, {
      pix: [pix(stored.txid, 'E-LATE', '10.00')],
    });

    expect(stored.status).toBe(PaymentStatus.UnderReview);
    expect(onPaymentPaid).not.toHaveBeenCalled();
  });
});
