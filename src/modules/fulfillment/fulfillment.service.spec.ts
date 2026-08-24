import { Types } from 'mongoose';
import { ConflictException } from '@nestjs/common';
import { PaymentStatus } from '../payments/payment.enums';
import { FulfillmentService } from './fulfillment.service';

describe('FulfillmentService referral attribution', () => {
  it('propaga la identidad snapshot del invitado para bloquear autorreferidos', async () => {
    const referrals = {
      attributeOrder: jest.fn().mockResolvedValue({}),
      approveOrder: jest.fn().mockResolvedValue({}),
    };
    const service = new FulfillmentService(
      {} as never,
      {} as never,
      {} as never,
      referrals as never,
      {} as never,
      {} as never,
    );
    const campaign = new Types.ObjectId();

    await (service as any).attributeReferral({
      publicId: 'order-guest',
      campaign,
      buyer: {
        name: 'Comprador',
        phone: '+5511999999999',
        email: 'buyer@example.com',
        cpf: '52998224725',
      },
      attribution: { referralCode: 'SOCIO1' },
      total: 100,
      subtotal: 90,
      currency: 'BRL',
    });

    expect(referrals.attributeOrder).toHaveBeenCalledWith(
      expect.objectContaining({
        buyerUserId: undefined,
        buyerPhone: '+5511999999999',
        buyerEmail: 'buyer@example.com',
        buyerCpf: '52998224725',
      }),
    );
    expect(referrals.approveOrder).toHaveBeenCalledWith('order-guest');
  });

  it('propaga fallos transitorios para que el outbox de pagos reintente', async () => {
    const referrals = {
      attributeOrder: jest.fn().mockRejectedValue(new Error('Mongo caído')),
      approveOrder: jest.fn(),
    };
    const service = buildService(referrals);

    await expect(
      (service as any).attributeReferral(referralOrder()),
    ).rejects.toThrow('Mongo caído');
  });

  it('trata un código no aplicable como rechazo de negocio permanente', async () => {
    const referrals = {
      attributeOrder: jest
        .fn()
        .mockRejectedValue(new ConflictException('Código no atribuible')),
      approveOrder: jest.fn(),
    };
    const service = buildService(referrals);

    await expect(
      (service as any).attributeReferral(referralOrder()),
    ).resolves.toBeUndefined();
  });

  it('usa eventKey estable en inbox y correo durable para invitados', async () => {
    const notifications = { create: jest.fn().mockResolvedValue({}) };
    const email = { enqueueAndDeliver: jest.fn().mockResolvedValue(undefined) };
    const service = new FulfillmentService(
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      notifications as never,
      email as never,
    );
    const event = {
      paymentId: '507f1f77bcf86cd799439099',
      status: PaymentStatus.Paid,
    };
    const message = {
      title: 'Pago confirmado',
      body: 'Tus títulos están disponibles.',
      type: 'payment',
    };

    await (service as any).notify(
      { ...referralOrder(), user: new Types.ObjectId() },
      message,
      event,
    );
    await (service as any).notify(referralOrder(), message, event);

    expect(notifications.create).toHaveBeenCalledWith(
      expect.objectContaining({
        eventKey: `fulfillment:${event.paymentId}:paid`,
      }),
    );
    expect(email.enqueueAndDeliver).toHaveBeenCalledWith(
      expect.objectContaining({
        eventKey: `fulfillment:${event.paymentId}:paid`,
        recipient: 'buyer@example.com',
      }),
    );
  });

  function buildService(referrals: Record<string, jest.Mock>) {
    return new FulfillmentService(
      {} as never,
      {} as never,
      {} as never,
      referrals as never,
      {} as never,
      {} as never,
    );
  }

  function referralOrder() {
    return {
      publicId: 'order-guest',
      campaign: new Types.ObjectId(),
      buyer: {
        name: 'Comprador',
        phone: '+5511999999999',
        email: 'buyer@example.com',
        cpf: '52998224725',
      },
      attribution: { referralCode: 'SOCIO1' },
      total: 100,
      subtotal: 90,
      currency: 'BRL',
    };
  }
});
