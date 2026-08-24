import { Injectable } from '@nestjs/common';
import { createHash } from 'crypto';
import { PaymentProviderName, PaymentStatus } from '../payment.enums';
import {
  CancelProviderPaymentInput,
  CreateProviderPaymentInput,
  FindProviderPaymentInput,
  PaymentProvider,
  ProviderPaymentResult,
  ProviderRefundResult,
  RefundProviderPaymentInput,
} from './payment-provider.interface';

@Injectable()
export class MockPaymentProvider implements PaymentProvider {
  readonly name = PaymentProviderName.Mock;

  private readonly payments = new Map<string, ProviderPaymentResult>();

  async createPayment(
    input: CreateProviderPaymentInput,
  ): Promise<ProviderPaymentResult> {
    const previous = this.payments.get(input.txid);
    if (previous) return previous;

    const checksum = createHash('sha256')
      .update(`${input.txid}:${input.amount}`)
      .digest('hex');
    const pixCopyPaste = `000201MOCKPIX${input.txid}${checksum.slice(0, 24)}`;
    const result: ProviderPaymentResult = {
      externalId: `mock_${input.txid}`,
      txid: input.txid,
      status: PaymentStatus.Active,
      qrCode: `mock://pix/${input.txid}`,
      pixCopyPaste,
      checkoutUrl: `mock://checkout/${input.txid}`,
      raw: {
        mock: true,
        expiresInSeconds: input.expiresInSeconds,
      },
    };
    this.payments.set(input.txid, result);
    return result;
  }

  async findPayment(
    input: FindProviderPaymentInput,
  ): Promise<ProviderPaymentResult> {
    return (
      this.payments.get(input.txid) ?? {
        externalId: input.externalId ?? `mock_${input.txid}`,
        txid: input.txid,
        status: PaymentStatus.Active,
        raw: { mock: true, restored: true },
      }
    );
  }

  async cancelPayment(
    input: CancelProviderPaymentInput,
  ): Promise<ProviderPaymentResult> {
    const current = await this.findPayment(input);
    const result = {
      ...current,
      status: PaymentStatus.Cancelled,
      raw: { ...current.raw, cancelReason: input.reason },
    };
    this.payments.set(input.txid, result);
    return result;
  }

  async refundPayment(
    input: RefundProviderPaymentInput,
  ): Promise<ProviderRefundResult> {
    const providerRefundId = createHash('sha256')
      .update(input.idempotencyKey)
      .digest('hex')
      .slice(0, 30);
    return {
      providerRefundId,
      status: PaymentStatus.Refunded,
      amount: input.amount,
      raw: { mock: true, endToEndId: input.endToEndId },
    };
  }
}
