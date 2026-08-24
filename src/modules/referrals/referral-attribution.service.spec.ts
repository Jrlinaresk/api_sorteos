import { ConflictException } from '@nestjs/common';
import { Types } from 'mongoose';
import { UsersService } from '../users/users.service';
import { ReferralAttributionService } from './referral-attribution.service';

describe('ReferralAttributionService self-referral protection', () => {
  const beneficiaryUser = new Types.ObjectId();
  const users = {
    findOneOrNull: jest.fn().mockResolvedValue({
      _id: beneficiaryUser,
      phone: '+5511999999999',
      email: 'affiliate@example.com',
      cpf: '52998224725',
    }),
  } as unknown as UsersService;
  const service = new ReferralAttributionService(
    {} as never,
    {} as never,
    {} as never,
    users,
  );
  const code = { beneficiaryUser } as never;

  beforeEach(() => jest.clearAllMocks());

  it.each([
    { buyerPhone: '(11) 99999-9999' },
    { buyerEmail: ' AFFILIATE@EXAMPLE.COM ' },
    { buyerCpf: '529.982.247-25' },
  ])(
    'rechaza invitado con identidad del beneficiario: %o',
    async (identity) => {
      await expect(
        (service as any).assertGuestIsNotBeneficiary(code, identity),
      ).rejects.toBeInstanceOf(ConflictException);
    },
  );

  it('permite una identidad distinta', async () => {
    await expect(
      (service as any).assertGuestIsNotBeneficiary(code, {
        buyerPhone: '+5511888888888',
        buyerEmail: 'buyer@example.com',
        buyerCpf: '11144477735',
      }),
    ).resolves.toBeUndefined();
  });
});
