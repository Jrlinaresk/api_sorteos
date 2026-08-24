import { Types } from 'mongoose';
import { ReferralClick } from './schemas/referral-click.schema';
import {
  ReferralCode,
  ReferralCodeStatus,
} from './schemas/referral-code.schema';
import {
  ReferralCommission,
  ReferralCommissionStatus,
} from './schemas/referral-commission.schema';

type WithDocumentId<T> = T & {
  _id?: Types.ObjectId | string;
  id?: string;
};

function documentId(value: { _id?: Types.ObjectId | string; id?: string }) {
  return value.id ?? value._id?.toString() ?? '';
}

export interface AdminReferralCodeView {
  id: string;
  code: string;
  beneficiaryUserId?: string;
  label?: string;
  status: ReferralCodeStatus;
  commissionRateBps: number;
  currency: string;
  campaignId?: string;
  validFrom?: Date;
  validUntil?: Date;
  maxConversions?: number;
  clicksCount: number;
  conversionsCount: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface AdminReferralClickView {
  id: string;
  code: string;
  eventId: string;
  campaignId?: string;
  landingPath?: string;
  referrer?: string;
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
  utmTerm?: string;
  utmContent?: string;
  attributedOrderId?: string;
  convertedAt?: Date;
  createdAt: Date;
}

export interface AdminReferralCommissionView {
  id: string;
  code: string;
  orderId: string;
  beneficiaryUserId?: string;
  buyerUserId?: string;
  orderAmount: number;
  commissionBase: number;
  commissionRateBps: number;
  commissionAmount: number;
  currency: string;
  status: ReferralCommissionStatus;
  statusChangedAt: Date;
  statusReason?: string;
  createdAt: Date;
  updatedAt: Date;
}

export type UserReferralCommissionView = Omit<
  AdminReferralCommissionView,
  'beneficiaryUserId' | 'buyerUserId' | 'orderAmount' | 'commissionBase'
>;

export function toAdminReferralCode(
  code: WithDocumentId<ReferralCode>,
): AdminReferralCodeView {
  return {
    id: documentId(code),
    code: code.code,
    beneficiaryUserId: code.beneficiaryUser?.toString(),
    label: code.label,
    status: code.status,
    commissionRateBps: code.commissionRateBps,
    currency: code.currency,
    campaignId: code.campaignId,
    validFrom: code.validFrom,
    validUntil: code.validUntil,
    maxConversions: code.maxConversions,
    clicksCount: code.clicksCount,
    conversionsCount: code.conversionsCount,
    createdAt: code.createdAt,
    updatedAt: code.updatedAt,
  };
}

export function toAdminReferralClick(
  click: WithDocumentId<ReferralClick>,
): AdminReferralClickView {
  return {
    id: documentId(click),
    code: click.code,
    eventId: click.eventId,
    campaignId: click.campaignId,
    landingPath: click.landingPath,
    referrer: click.referrer,
    utmSource: click.utmSource,
    utmMedium: click.utmMedium,
    utmCampaign: click.utmCampaign,
    utmTerm: click.utmTerm,
    utmContent: click.utmContent,
    attributedOrderId: click.attributedOrderId,
    convertedAt: click.convertedAt,
    createdAt: click.createdAt,
  };
}

export function toAdminReferralCommission(
  commission: WithDocumentId<ReferralCommission>,
): AdminReferralCommissionView {
  return {
    id: documentId(commission),
    code: commission.code,
    orderId: commission.orderId,
    beneficiaryUserId: commission.beneficiaryUser?.toString(),
    buyerUserId: commission.buyerUser?.toString(),
    orderAmount: commission.orderAmount,
    commissionBase: commission.commissionBase,
    commissionRateBps: commission.commissionRateBps,
    commissionAmount: commission.commissionAmount,
    currency: commission.currency,
    status: commission.status,
    statusChangedAt: commission.statusChangedAt,
    statusReason: commission.statusReason,
    createdAt: commission.createdAt,
    updatedAt: commission.updatedAt,
  };
}

export function toUserReferralCommission(
  commission: WithDocumentId<ReferralCommission>,
): UserReferralCommissionView {
  const admin = toAdminReferralCommission(commission);
  return {
    id: admin.id,
    code: admin.code,
    orderId: admin.orderId,
    commissionRateBps: admin.commissionRateBps,
    commissionAmount: admin.commissionAmount,
    currency: admin.currency,
    status: admin.status,
    statusChangedAt: admin.statusChangedAt,
    statusReason: admin.statusReason,
    createdAt: admin.createdAt,
    updatedAt: admin.updatedAt,
  };
}
