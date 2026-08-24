export enum PaymentStatus {
  Created = 'created',
  Pending = 'pending',
  Active = 'active',
  Paid = 'paid',
  Expired = 'expired',
  Cancelled = 'cancelled',
  Rejected = 'rejected',
  Failed = 'failed',
  RefundPending = 'refund_pending',
  PartiallyRefunded = 'partially_refunded',
  Refunded = 'refunded',
  UnderReview = 'under_review',
  Disputed = 'disputed',
  Chargeback = 'chargeback',
}

export enum PaymentProviderName {
  Mock = 'mock',
  Efi = 'efi',
}

export enum PaymentCurrency {
  BRL = 'BRL',
}

export enum PaymentEventSource {
  Application = 'application',
  Provider = 'provider',
  Webhook = 'webhook',
  Reconciliation = 'reconciliation',
  Admin = 'admin',
}

export const TERMINAL_PAYMENT_STATUSES = new Set<PaymentStatus>([
  PaymentStatus.Expired,
  PaymentStatus.Cancelled,
  PaymentStatus.Rejected,
  PaymentStatus.Failed,
  PaymentStatus.Refunded,
  PaymentStatus.Chargeback,
]);
