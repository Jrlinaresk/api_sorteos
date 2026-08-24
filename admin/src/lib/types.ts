export type UserRole = 'customer' | 'operator' | 'admin';

export interface AdminUser {
  id: string;
  phone: string;
  nickname?: string;
  name?: string;
  cpf?: string;
  email?: string;
  role: UserRole;
  isActive: boolean;
  emailVerified: boolean;
  balance: number;
  address?: string;
  profilePictureUrl?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface AdminSession {
  accessToken: string;
  tokenType: 'Bearer';
  expiresIn: string;
  user: AdminUser;
}

export interface ApiErrorBody {
  statusCode?: number;
  message?: string | string[];
  code?: string;
  correlationId?: string;
  meta?: Record<string, unknown>;
}

export interface PageMeta {
  page: number;
  limit: number;
  total: number;
  pages?: number;
  hasNextPage?: boolean;
}

export interface DataPage<T> {
  data: T[];
  meta: PageMeta;
}

export type CampaignStatus =
  | 'draft'
  | 'scheduled'
  | 'active'
  | 'open'
  | 'expired'
  | 'sold_out'
  | 'awaiting_draw'
  | 'drawn'
  | 'closed'
  | 'cancelled';

export type DrawMethod =
  'federal_lottery' | 'manual_external' | 'cryptographic';

export interface Campaign {
  _id?: string;
  id?: string;
  name: string;
  slug: string;
  shortDescription?: string;
  description?: string;
  regulationHtml?: string;
  termsVersion: string;
  imageUrl?: string;
  media?: CampaignMedia[];
  category?: string | Category;
  size?: 'small' | 'medium' | 'large';
  costLevel?: 'low' | 'medium' | 'high';
  status: CampaignStatus;
  statusLabel?: string;
  statusText?: string;
  totalTitles: number;
  quotaDigits: number;
  soldCount: number;
  reservedCount: number;
  maxParticipants?: number;
  launchAt?: string;
  closesAt?: string;
  drawDate?: string;
  salesClosedAt?: string;
  currency: string;
  itemPrice: number;
  ticketPrice: number;
  itemCondition: 'new' | 'used';
  prizeTitle: string;
  cashAlternative?: number;
  minimumOrderAmount: number;
  maxTitlesPerOrder: number;
  quantitySuggestions: number[];
  promotionTiers: PromotionTier[];
  drawMethod: DrawMethod;
  federalLottery?: FederalLotteryConfig;
  modules?: CampaignModules;
  instantGame?: InstantGameConfig;
  notice?: TimedContent;
  doubleChance?: DoubleChanceConfig;
  contacts?: CampaignContacts;
  seo?: CampaignSeo;
  analytics?: CampaignAnalytics;
  progressOverride?: number;
  featured: boolean;
  sortOrder: number;
  winningQuotaNumber?: string;
  resultPublishedAt?: string;
  allowedTransitions?: CampaignStatus[];
  createdAt?: string;
  updatedAt?: string;
}

export interface CampaignMedia {
  url?: string;
  mediaId?: string;
  type: 'image' | 'video';
  alt?: string;
  sortOrder: number;
  isCover: boolean;
}

export interface PromotionTier {
  quantity: number;
  totalPrice: number;
  label?: string;
  active: boolean;
}

export interface FederalLotteryConfig {
  firstPrizeDigits: number;
  secondPrizeDigits: number;
  combination: 'concatenate' | 'sum';
  contest?: string;
  extraction?: string;
  firstPrize?: string;
  secondPrize?: string;
  sourceUrl?: string;
  publishedAt?: string;
}

export interface CampaignModules {
  showProgress: boolean;
  showTopBuyers: boolean;
  showMinMaxQuota: boolean;
  showInstantPrizes: boolean;
  showParticipantsDownload: boolean;
  showTitleLookup: boolean;
  showSocialButtons: boolean;
  showCountdown: boolean;
}

export interface InstantGameConfig {
  enabled: boolean;
  mechanic: 'roulette' | 'scratch';
  noPrizeWeight: number;
  tiers: Array<{ quantity: number; attempts: number }>;
}

export interface TimedContent {
  enabled: boolean;
  title?: string;
  description?: string;
  startsAt?: string;
  endsAt?: string;
}

export interface DoubleChanceConfig extends TimedContent {
  multiplier: number;
}

export interface CampaignContacts {
  instagram?: string;
  telegram?: string;
  whatsapp?: string;
}

export interface CampaignSeo {
  title?: string;
  description?: string;
  keywords?: string[];
  shareImageUrl?: string;
}

export interface CampaignAnalytics {
  metaPixelId?: string;
  googleTagManagerId?: string;
  enabled: boolean;
}

export interface Category {
  _id?: string;
  id?: string;
  name: string;
  description?: string;
  createdAt?: string;
  updatedAt?: string;
}

export type OrderStatus =
  | 'reserved'
  | 'pending_payment'
  | 'paid'
  | 'expired'
  | 'cancelled'
  | 'rejected'
  | 'refunded'
  | 'in_review'
  | 'disputed';

export interface Order {
  _id?: string;
  id?: string;
  publicId: string;
  campaign?: CampaignSummary | string;
  user?: AdminUser | string;
  buyer: {
    name: string;
    phone: string;
    email: string;
    cpf: string;
  };
  selectedQuantity: number;
  bonusQuantity: number;
  allocatedQuantity: number;
  unitPrice: number;
  subtotal: number;
  discount: number;
  total: number;
  currency: string;
  status: OrderStatus;
  reservedAt: string;
  expiresAt: string;
  paidAt?: string;
  cancelledAt?: string;
  refundedAt?: string;
  payment?: PaymentSummary | string;
  titleNumbers?: string[];
  quotas?: Quota[];
  statusHistory?: Array<{
    status: string;
    at: string;
    reason?: string;
    actor?: string;
  }>;
  termsVersion: string;
  termsAcceptedAt: string;
  attribution?: Record<string, string>;
  createdAt?: string;
  updatedAt?: string;
}

export interface CampaignSummary {
  _id?: string;
  id?: string;
  name: string;
  slug: string;
  status?: CampaignStatus;
}

export interface PaymentSummary {
  _id?: string;
  id?: string;
  status: PaymentStatus;
  provider: string;
  amount: number;
  currency: string;
  paidAt?: string;
  expiresAt?: string;
}

export interface Quota {
  _id?: string;
  id?: string;
  number: string;
  status: string;
  isBonus: boolean;
  paidAt?: string;
}

export type PaymentStatus =
  | 'created'
  | 'pending'
  | 'active'
  | 'paid'
  | 'expired'
  | 'cancelled'
  | 'rejected'
  | 'failed'
  | 'refund_pending'
  | 'partially_refunded'
  | 'refunded'
  | 'under_review'
  | 'disputed'
  | 'chargeback';

export interface Payment {
  _id?: string;
  id?: string;
  order: string;
  campaign: string;
  user?: string;
  status: PaymentStatus;
  provider: 'efi' | 'mock';
  externalId?: string;
  txid: string;
  endToEndId?: string;
  endToEndIds?: string[];
  amount: number;
  amountCents: number;
  receivedAmountCents: number;
  refundedAmountCents: number;
  refundReservedAmountCents?: number;
  currency: string;
  expiresAt: string;
  paidAt?: string;
  cancelledAt?: string;
  refundedAt?: string;
  refundedAmount?: number;
  providerError?: string;
  lifecycleHookError?: string;
  lifecycleHookProcessedAt?: string;
  statusHistory?: Array<Record<string, unknown>>;
  receipts?: Array<Record<string, unknown>>;
  refunds?: Array<Record<string, unknown>>;
  createdAt?: string;
  updatedAt?: string;
}

export interface PaymentsPage {
  data: Payment[];
  page: number;
  limit: number;
  total: number;
  pages: number;
}

export type PrizeMechanic = 'winning_title' | 'roulette' | 'scratch';
export type PrizeAwardStatus = 'awarded' | 'claimed' | 'fulfilled' | 'reversed';

export interface InstantPrize {
  _id?: string;
  id?: string;
  campaign: CampaignSummary | string;
  mechanic: PrizeMechanic;
  title: string;
  description?: string;
  winningTitle?: string;
  stock: number;
  remainingStock?: number;
  weight?: number;
  cashValue?: number;
  alternativeTitle?: string;
  imageUrl?: string;
  status?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface PrizeAward {
  _id?: string;
  id?: string;
  publicId: string;
  campaign: CampaignSummary | string;
  prize: InstantPrize | string;
  order: Order | string;
  mechanic: PrizeMechanic;
  title: string;
  description?: string;
  cashValue?: number;
  winnerSnapshot: { name: string; phone: string };
  status: PrizeAwardStatus;
  awardedAt: string;
  claimedAt?: string;
  fulfilledAt?: string;
}

export type MainAwardStatus = 'pending' | 'claimed' | 'fulfilled';

export interface MainAward {
  _id?: string;
  id?: string;
  publicId: string;
  campaign: CampaignSummary | string;
  orderPublicId: string;
  prizeTitle: string;
  cashAlternative?: number;
  currency: string;
  winningNumber: string;
  winnerSnapshot: { name: string; phone: string; email: string };
  status: MainAwardStatus;
  choice?: 'physical' | 'cash';
  awardedAt: string;
  claimedAt?: string;
  fulfilledAt?: string;
  fulfillmentReference?: string;
  fulfillmentNotes?: string;
  lastNotificationError?: string;
}

export interface DrawResult {
  _id?: string;
  id?: string;
  campaign: string;
  method: DrawMethod;
  status: 'draft' | 'verified' | 'published' | 'cancelled';
  contest?: string;
  sourceUrl?: string;
  calculationRule: string;
  evidenceHash: string;
  outcomes: Array<{
    position: number;
    prizeTitle: string;
    winningNumber: string;
    winnerSnapshot?: { name: string; phone: string };
  }>;
  verifiedBy?: string;
  verifiedAt?: string;
  publishedBy?: string;
  publishedAt?: string;
}

export interface MediaAsset {
  id: string;
  originalName?: string;
  mimeType: string;
  kind: 'image' | 'video';
  size: number;
  checksum?: string;
  status: string;
  publicUrl?: string;
  url?: string;
  referenced?: boolean;
  references?: string[];
  uploadedBy?: string;
  createdAt: string;
  deletedAt?: string;
}

export interface StorageUsage {
  totalBytes: number;
  totalLimitBytes: number;
  userBytes: number;
  userLimitBytes: number;
  deletedRetentionDays: number;
}

export interface ReferralCode {
  id: string;
  code: string;
  label?: string;
  status: 'active' | 'inactive' | 'expired';
  commissionRateBps: number;
  campaignId?: string;
  beneficiaryUserId?: string;
  clicksCount: number;
  conversionsCount: number;
  expiresAt?: string;
  maxConversions?: number;
  createdAt?: string;
  updatedAt?: string;
}

export interface ReferralClick {
  id: string;
  code: string;
  visitorId?: string;
  landingPage?: string;
  source?: string;
  medium?: string;
  campaign?: string;
  convertedAt?: string;
  createdAt: string;
}

export interface ReferralCommission {
  id: string;
  code: string;
  orderId: string;
  beneficiaryUserId?: string;
  commissionRateBps: number;
  commissionAmount: number;
  currency: string;
  status: string;
  statusChangedAt: string;
  statusReason?: string;
  createdAt: string;
}

export interface Notification {
  id: string;
  userId: string;
  title: string;
  body: string;
  type: string;
  data: Record<string, unknown>;
  imageUrl?: string;
  actionUrl?: string;
  deliveryStatus: string;
  deliveryAttempts: number;
  deliveryCode?: string;
  deliveryAccepted: number;
  deliveryRejected: number;
  lastDeliveryError?: string;
  deliveredAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface SiteSettings {
  id: string;
  version: number;
  status: 'draft' | 'published' | 'archived';
  brand: Record<string, unknown>;
  contact: Record<string, unknown>;
  social: Record<string, unknown>;
  theme: Record<string, unknown>;
  legal: Record<string, unknown>;
  featureFlags: Record<string, boolean>;
  changeNote?: string;
  publishedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface AuditLog {
  id: string;
  action: string;
  category: string;
  outcome: 'success' | 'failure';
  actorId?: string;
  actorRole?: string;
  actorLabel?: string;
  resourceType?: string;
  resourceId?: string;
  correlationId?: string;
  ip?: string;
  metadata?: Record<string, unknown>;
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
  errorCode?: string;
  errorMessage?: string;
  createdAt: string;
}

export interface DashboardSummary {
  generatedAt: string;
  range: { days: number; from: string };
  campaigns: {
    total: number;
    active: number;
    scheduled: number;
    awaitingDraw: number;
    byStatus: Record<string, number>;
  };
  orders: {
    total: number;
    paid: number;
    pending: number;
    attention: number;
    byStatus: Record<string, number>;
  };
  finance: {
    receivedCents: number;
    refundedCents: number;
    netCents: number;
    paymentCount: number;
    paymentsUnderReview: number;
  };
  users: { total: number; active: number };
  prizes: {
    instantClaimed: number;
    instantPending: number;
    mainPending: number;
    mainClaimed: number;
  };
  dailySales: Array<{
    date: string;
    orders: number;
    revenueCents: number;
    titles: number;
  }>;
  topCampaigns: Array<{
    campaignId: string;
    name: string;
    slug: string;
    orders: number;
    revenueCents: number;
    titles: number;
  }>;
  recentOrders: Array<{
    id: string;
    publicId: string;
    buyerName: string;
    status: OrderStatus;
    totalCents: number;
    currency: string;
    allocatedQuantity: number;
    campaign: CampaignSummary | null;
    createdAt: string;
    paidAt?: string;
  }>;
}

export function entityId(entity: { id?: string; _id?: string } | string) {
  return typeof entity === 'string' ? entity : entity.id || entity._id || '';
}
