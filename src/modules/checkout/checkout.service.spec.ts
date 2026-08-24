import { Types } from 'mongoose';
import { OrderStatus } from '../orders/schemas/order.schema';
import {
  PaymentCurrency,
  PaymentProviderName,
  PaymentStatus,
} from '../payments/payment.enums';
import { CheckoutService } from './checkout.service';

describe('CheckoutService', () => {
  const orderId = new Types.ObjectId();
  const campaignId = new Types.ObjectId();
  const paymentId = new Types.ObjectId();
  const publicId = 'order-public-id';
  const accessToken = 'order-access-token';

  let orders: Record<string, jest.Mock>;
  let payments: Record<string, jest.Mock>;
  let service: CheckoutService;

  const payment = {
    _id: paymentId,
    status: PaymentStatus.Active,
    provider: PaymentProviderName.Mock,
    txid: '12345678901234567890123456789012',
    amount: 34.99,
    currency: PaymentCurrency.BRL,
    expiresAt: new Date(Date.now() + 15 * 60_000),
    refundedAmount: 0,
  };

  const reservation = () => ({
    _id: orderId,
    publicId,
    id: publicId,
    accessToken,
    campaign: campaignId,
    buyer: {
      name: 'Maria da Silva',
      phone: '+5511999999999',
      email: 'maria@example.com',
      cpf: '52998224725',
    },
    total: 34.99,
    currency: PaymentCurrency.BRL,
    status: OrderStatus.Reserved,
    expiresAt: new Date(Date.now() + 15 * 60_000),
  });

  beforeEach(() => {
    orders = {
      createReservation: jest.fn().mockResolvedValue(reservation()),
      attachPayment: jest.fn().mockResolvedValue(undefined),
      findByPublicId: jest.fn().mockResolvedValue({ id: publicId }),
      cancelByIdSystem: jest.fn().mockResolvedValue(undefined),
      findOwnedForCheckout: jest.fn(),
      cancel: jest.fn(),
      markPaidByPayment: jest.fn().mockResolvedValue(undefined),
      markPaymentCancelled: jest.fn().mockResolvedValue(undefined),
      markRefundedByPayment: jest.fn().mockResolvedValue(undefined),
      markPaymentReview: jest.fn().mockResolvedValue(undefined),
    };
    payments = {
      registerLifecycleHooks: jest.fn().mockReturnValue(jest.fn()),
      create: jest.fn().mockResolvedValue({
        payment,
        accessSecret: 'payment-access-secret',
        idempotentReplay: false,
      }),
      findByIdempotencyKey: jest.fn().mockResolvedValue(null),
      reconcile: jest.fn(),
      retryLifecycleHooks: jest.fn().mockResolvedValue(payment),
      toPublicView: jest.fn().mockReturnValue({
        id: paymentId.toString(),
        status: PaymentStatus.Active,
        amount: 34.99,
      }),
      cancel: jest.fn().mockResolvedValue(payment),
      findById: jest.fn().mockResolvedValue(payment),
    };
    service = new CheckoutService(orders as any, payments as any);
  });

  it('uses the server-calculated order total and supports a guest buyer', async () => {
    const result = await service.create({
      campaignSlug: 'titan-160',
      quantity: 500,
      buyer: reservation().buyer,
      termsVersion: 'v1',
      idempotencyKey: 'checkout-client-request-001',
    });

    expect(payments.create).toHaveBeenCalledWith(
      expect.objectContaining({
        orderId: orderId.toString(),
        campaignId: campaignId.toString(),
        userId: undefined,
        amount: 34.99,
        currency: PaymentCurrency.BRL,
        idempotencyKey: `checkout:${orderId}`,
      }),
    );
    expect(orders.attachPayment).toHaveBeenCalledWith(
      orderId.toString(),
      paymentId,
    );
    expect(payments.retryLifecycleHooks).toHaveBeenCalledWith(
      paymentId.toString(),
    );
    expect(result).toEqual(
      expect.objectContaining({
        orderAccessToken: accessToken,
        paymentAccessSecret: 'payment-access-secret',
      }),
    );
  });

  it('associa la compra a la cuenta cuando el JWT opcional es válido', async () => {
    const userId = new Types.ObjectId();
    orders.createReservation.mockResolvedValue({
      ...reservation(),
      user: userId,
    });
    const dto = {
      campaignSlug: 'titan-160',
      quantity: 50,
      buyer: reservation().buyer,
      termsVersion: 'v1',
      idempotencyKey: 'checkout-client-request-account',
    };

    await service.create(dto, userId.toString());

    expect(orders.createReservation).toHaveBeenCalledWith(
      dto,
      userId.toString(),
    );
    expect(payments.create).toHaveBeenCalledWith(
      expect.objectContaining({ userId: userId.toString() }),
    );
  });

  it('releases the quota reservation when a payment cannot be created or reconciled', async () => {
    payments.create.mockRejectedValue(new Error('provider unavailable'));

    await expect(
      service.create({
        campaignSlug: 'titan-160',
        quantity: 500,
        buyer: reservation().buyer,
        termsVersion: 'v1',
        idempotencyKey: 'checkout-client-request-002',
      }),
    ).rejects.toThrow('provider unavailable');

    expect(orders.cancelByIdSystem).toHaveBeenCalledWith(
      orderId.toString(),
      OrderStatus.Cancelled,
      expect.any(String),
    );
    expect(orders.attachPayment).not.toHaveBeenCalled();
  });

  it('registers callbacks and maps paid/refunded/cancelled/review states to orders', async () => {
    service.onModuleInit();
    expect(payments.registerLifecycleHooks).toHaveBeenCalledWith(service);

    const baseEvent = {
      paymentId: paymentId.toString(),
      orderId: orderId.toString(),
      campaignId: campaignId.toString(),
      provider: PaymentProviderName.Mock,
      previousStatus: PaymentStatus.Active,
      status: PaymentStatus.Paid,
      source: 'webhook' as any,
      amount: 34.99,
      currency: PaymentCurrency.BRL,
      txid: payment.txid,
    };

    await service.onPaymentPaid(baseEvent);
    await service.onPaymentCancelled({
      ...baseEvent,
      status: PaymentStatus.Expired,
    });
    await service.onPaymentRefunded({
      ...baseEvent,
      previousStatus: PaymentStatus.Paid,
      status: PaymentStatus.Refunded,
    });
    await service.onPaymentStatusChanged({
      ...baseEvent,
      status: PaymentStatus.UnderReview,
    });

    expect(orders.markPaidByPayment).toHaveBeenCalledWith(
      paymentId.toString(),
      expect.any(Date),
    );
    expect(orders.markPaymentCancelled).toHaveBeenCalledWith(
      paymentId.toString(),
      OrderStatus.Expired,
      expect.any(String),
    );
    expect(orders.markRefundedByPayment).toHaveBeenCalledWith(
      paymentId.toString(),
      expect.any(String),
    );
    expect(orders.markPaymentReview).toHaveBeenCalledWith(
      paymentId.toString(),
      expect.any(String),
    );
  });

  it('authenticates cancellation with the order token and cancels its provider payment', async () => {
    orders.findOwnedForCheckout.mockResolvedValue({
      payment: paymentId,
      status: OrderStatus.PendingPayment,
    });

    await service.cancel(publicId, accessToken, { reason: 'No lo quiero' });

    expect(orders.findOwnedForCheckout).toHaveBeenCalledWith(
      publicId,
      accessToken,
      undefined,
    );
    expect(payments.cancel).toHaveBeenCalledWith(
      paymentId.toString(),
      'No lo quiero',
    );
    expect(orders.markPaymentCancelled).toHaveBeenCalledWith(
      paymentId,
      OrderStatus.Cancelled,
      'No lo quiero',
    );
  });
});
