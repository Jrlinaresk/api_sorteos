import { Types } from 'mongoose';
import {
  PaymentCurrency,
  PaymentProviderName,
  PaymentStatus,
} from './payment.enums';
import { PaymentsService } from './payments.service';

function query<T>(value: T) {
  return { exec: jest.fn().mockResolvedValue(value) };
}

function duePayment() {
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
    expiresAt: new Date(Date.now() - 60_000),
    receipts: [],
    providerRefunds: [],
    endToEndIds: [],
    refunds: [],
    statusHistory: [],
    transitionSequence: 0,
    save: jest.fn(),
  };
  payment.save.mockImplementation(async () => payment);
  return payment;
}

function setup(payment: Record<string, any>, findPayment: jest.Mock) {
  const paymentModel = {
    find: jest.fn().mockReturnValue(query([payment])),
    findById: jest.fn().mockReturnValue(query(payment)),
  };
  const provider = { findPayment };
  const service = new PaymentsService(
    paymentModel as never,
    { get: jest.fn().mockReturnValue(provider) } as never,
    { get: jest.fn() } as never,
  );
  return { service, paymentModel };
}

describe('PaymentsService safe Pix expiration', () => {
  it('reconciles with the PSP and settles a just-paid Pix instead of expiring it', async () => {
    const payment = duePayment();
    const receipt = {
      endToEndId: 'E1234567890123456789012345678901',
      amountCents: 1_000,
      paidAt: new Date(),
    };
    const findPayment = jest.fn().mockResolvedValue({
      txid: payment.txid,
      status: PaymentStatus.Paid,
      receipts: [receipt],
    });
    const { service } = setup(payment, findPayment);

    await expect(service.expireDuePayments()).resolves.toBe(0);

    expect(findPayment).toHaveBeenCalledWith({
      txid: payment.txid,
      externalId: undefined,
    });
    expect(payment.status).toBe(PaymentStatus.Paid);
    expect(payment.receivedAmountCents).toBe(1_000);
  });

  it('expires only after the PSP confirms that the charge remains payable and unpaid', async () => {
    const payment = duePayment();
    const findPayment = jest.fn().mockResolvedValue({
      txid: payment.txid,
      status: PaymentStatus.Active,
    });
    const { service } = setup(payment, findPayment);

    await expect(service.expireDuePayments()).resolves.toBe(1);

    expect(payment.status).toBe(PaymentStatus.Expired);
  });

  it('quarantines the payment when the PSP cannot be consulted and never expires it', async () => {
    const payment = duePayment();
    const { service } = setup(
      payment,
      jest.fn().mockRejectedValue(new Error('provider unavailable')),
    );

    await expect(service.expireDuePayments()).resolves.toBe(0);

    expect(payment.status).toBe(PaymentStatus.UnderReview);
    expect(payment.statusHistory.at(-1)).toEqual(
      expect.objectContaining({
        status: PaymentStatus.UnderReview,
        reason: expect.stringContaining('reserva queda bloqueada'),
      }),
    );
  });

  it('does not overwrite a concurrent paid transition after a failed reconciliation', async () => {
    const payment = duePayment();
    const findPayment = jest.fn().mockImplementation(async () => {
      payment.status = PaymentStatus.Paid;
      throw new Error('provider unavailable');
    });
    const { service } = setup(payment, findPayment);

    await expect(service.expireDuePayments()).resolves.toBe(0);

    expect(payment.status).toBe(PaymentStatus.Paid);
    expect(payment.statusHistory).toHaveLength(0);
  });

  it('allows an operator reconciliation to expire a quarantined charge once the PSP recovers', async () => {
    const payment = duePayment();
    const findPayment = jest
      .fn()
      .mockRejectedValueOnce(new Error('provider unavailable'))
      .mockResolvedValueOnce({
        txid: payment.txid,
        status: PaymentStatus.Active,
      });
    const { service } = setup(payment, findPayment);

    await service.expireDuePayments();
    expect(payment.status).toBe(PaymentStatus.UnderReview);

    await service.reconcile(payment._id.toString());
    expect(payment.status).toBe(PaymentStatus.Expired);
  });

  it('never releases an expired review that already contains a Pix receipt', async () => {
    const payment = duePayment();
    payment.status = PaymentStatus.UnderReview;
    payment.receivedAmountCents = 400;
    payment.receipts = [
      {
        endToEndId: 'E1234567890123456789012345678901',
        amountCents: 400,
        paidAt: new Date(),
      },
    ];
    const { service } = setup(
      payment,
      jest.fn().mockResolvedValue({
        txid: payment.txid,
        status: PaymentStatus.Active,
      }),
    );

    await service.reconcile(payment._id.toString());

    expect(payment.status).toBe(PaymentStatus.UnderReview);
    expect(payment.statusHistory).toHaveLength(0);
  });
});
