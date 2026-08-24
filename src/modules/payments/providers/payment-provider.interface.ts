import {
  PaymentCurrency,
  PaymentProviderName,
  PaymentStatus,
} from '../payment.enums';

export interface ProviderPayer {
  name: string;
  cpf?: string;
  cnpj?: string;
}

export interface CreateProviderPaymentInput {
  txid: string;
  amount: number;
  currency: PaymentCurrency;
  expiresInSeconds: number;
  description?: string;
  payer?: ProviderPayer;
  idempotencyKey: string;
}

export interface FindProviderPaymentInput {
  txid: string;
  externalId?: string;
}

export interface CancelProviderPaymentInput extends FindProviderPaymentInput {
  reason?: string;
}

export interface RefundProviderPaymentInput extends FindProviderPaymentInput {
  endToEndId: string;
  amount: number;
  idempotencyKey: string;
}

export interface ProviderPaymentResult {
  externalId?: string;
  txid: string;
  endToEndId?: string;
  status: PaymentStatus;
  qrCode?: string;
  qrCodeImage?: string;
  pixCopyPaste?: string;
  checkoutUrl?: string;
  paidAt?: Date;
  raw?: Record<string, unknown>;
}

export interface ProviderRefundResult {
  providerRefundId: string;
  status: PaymentStatus;
  amount: number;
  raw?: Record<string, unknown>;
}

export interface PaymentProvider {
  readonly name: PaymentProviderName;
  createPayment(
    input: CreateProviderPaymentInput,
  ): Promise<ProviderPaymentResult>;
  findPayment(input: FindProviderPaymentInput): Promise<ProviderPaymentResult>;
  cancelPayment(
    input: CancelProviderPaymentInput,
  ): Promise<ProviderPaymentResult>;
  refundPayment(
    input: RefundProviderPaymentInput,
  ): Promise<ProviderRefundResult>;
}

export class PaymentProviderError extends Error {
  constructor(
    message: string,
    readonly provider: PaymentProviderName,
    readonly statusCode?: number,
    readonly response?: unknown,
  ) {
    super(message);
    this.name = PaymentProviderError.name;
  }
}
