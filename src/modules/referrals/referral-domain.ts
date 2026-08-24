import { randomBytes } from 'crypto';
import {
  ReferralCode,
  ReferralCodeStatus,
} from './schemas/referral-code.schema';
import { ReferralCommissionStatus } from './schemas/referral-commission.schema';

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function normalizeReferralCode(code: string): string {
  return code.trim().toUpperCase();
}

export function generateReferralCode(length = 10): string {
  if (!Number.isInteger(length) || length < 4 || length > 32) {
    throw new Error('La longitud del código debe estar entre 4 y 32');
  }
  const bytes = randomBytes(length);
  let result = '';
  for (let index = 0; index < length; index += 1) {
    result += CODE_ALPHABET[bytes[index] % CODE_ALPHABET.length];
  }
  return result;
}

export function isReferralCodeUsable(
  code: Pick<
    ReferralCode,
    | 'status'
    | 'validFrom'
    | 'validUntil'
    | 'maxConversions'
    | 'conversionsCount'
    | 'campaignId'
  >,
  at = new Date(),
  campaignId?: string,
): boolean {
  if (code.status !== ReferralCodeStatus.Active) return false;
  if (code.validFrom && code.validFrom > at) return false;
  if (code.validUntil && code.validUntil <= at) return false;
  if (
    code.maxConversions !== undefined &&
    code.conversionsCount >= code.maxConversions
  ) {
    return false;
  }
  if (code.campaignId && code.campaignId !== campaignId) return false;
  return true;
}

/** Calcula en centavos para evitar deriva binaria y devuelve unidades mayores. */
export function calculateCommissionAmount(
  commissionBase: number,
  commissionRateBps: number,
): number {
  if (!Number.isFinite(commissionBase) || commissionBase < 0) {
    throw new Error('Base de comisión inválida');
  }
  if (
    !Number.isInteger(commissionRateBps) ||
    commissionRateBps < 0 ||
    commissionRateBps > 10_000
  ) {
    throw new Error('Tasa de comisión inválida');
  }
  const baseCents = Math.round(commissionBase * 100);
  const commissionCents = Math.round((baseCents * commissionRateBps) / 10_000);
  return commissionCents / 100;
}

const ALLOWED_TRANSITIONS: Record<
  ReferralCommissionStatus,
  Set<ReferralCommissionStatus>
> = {
  [ReferralCommissionStatus.Pending]: new Set([
    ReferralCommissionStatus.Approved,
    ReferralCommissionStatus.Rejected,
    ReferralCommissionStatus.Reversed,
  ]),
  [ReferralCommissionStatus.Approved]: new Set([
    ReferralCommissionStatus.Paid,
    ReferralCommissionStatus.Rejected,
    ReferralCommissionStatus.Reversed,
  ]),
  [ReferralCommissionStatus.Paid]: new Set([ReferralCommissionStatus.Reversed]),
  [ReferralCommissionStatus.Rejected]: new Set(),
  [ReferralCommissionStatus.Reversed]: new Set(),
};

export function canTransitionCommission(
  from: ReferralCommissionStatus,
  to: ReferralCommissionStatus,
): boolean {
  return from === to || ALLOWED_TRANSITIONS[from].has(to);
}
