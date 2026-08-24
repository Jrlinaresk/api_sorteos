import {
  calculateCommissionAmount,
  canTransitionCommission,
  isReferralCodeUsable,
  normalizeReferralCode,
} from './referral-domain';
import { ReferralCodeStatus } from './schemas/referral-code.schema';
import { ReferralCommissionStatus } from './schemas/referral-commission.schema';

describe('referral domain', () => {
  it('normaliza códigos y calcula comisión en centavos', () => {
    expect(normalizeReferralCode(' promo-07 ')).toBe('PROMO-07');
    expect(calculateCommissionAmount(34.99, 500)).toBe(1.75);
    expect(calculateCommissionAmount(0.07, 500)).toBe(0);
  });

  it('valida vigencia, límite y campaña', () => {
    const code = {
      status: ReferralCodeStatus.Active,
      validFrom: new Date('2026-01-01T00:00:00.000Z'),
      validUntil: new Date('2027-01-01T00:00:00.000Z'),
      maxConversions: 10,
      conversionsCount: 9,
      campaignId: 'campaign-1',
    };
    const now = new Date('2026-08-24T12:00:00.000Z');
    expect(isReferralCodeUsable(code, now, 'campaign-1')).toBe(true);
    expect(isReferralCodeUsable(code, now, 'campaign-2')).toBe(false);
    expect(
      isReferralCodeUsable(
        { ...code, conversionsCount: 10 },
        now,
        'campaign-1',
      ),
    ).toBe(false);
  });

  it('impide reabrir estados terminales de comisión', () => {
    expect(
      canTransitionCommission(
        ReferralCommissionStatus.Pending,
        ReferralCommissionStatus.Approved,
      ),
    ).toBe(true);
    expect(
      canTransitionCommission(
        ReferralCommissionStatus.Paid,
        ReferralCommissionStatus.Pending,
      ),
    ).toBe(false);
    expect(
      canTransitionCommission(
        ReferralCommissionStatus.Rejected,
        ReferralCommissionStatus.Approved,
      ),
    ).toBe(false);
  });
});
