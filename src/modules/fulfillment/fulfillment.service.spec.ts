import { Types } from 'mongoose';
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
});
