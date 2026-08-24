import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { createHash, createHmac, timingSafeEqual } from 'crypto';
import { Model, Types } from 'mongoose';
import {
  DEFAULT_PAYMENT_EXPIRATION_SECONDS,
  MAX_PAYMENT_EXPIRATION_SECONDS,
  MIN_PAYMENT_EXPIRATION_SECONDS,
} from './payment.constants';
import { CreatePaymentDto } from './dto/create-payment.dto';
import { RefundPaymentDto } from './dto/refund-payment.dto';
import {
  PaymentCurrency,
  PaymentEventSource,
  PaymentProviderName,
  PaymentStatus,
} from './payment.enums';
import { PaymentProviderFactory } from './providers/payment-provider.factory';
import {
  PaymentProvider,
  ProviderPaymentResult,
  PaymentProviderError,
} from './providers/payment-provider.interface';
import {
  Payment,
  PaymentDocument,
  PaymentRefund,
  PaymentStatusHistoryEntry,
} from './schemas/payment.schema';
import { mapEfiRefundStatus } from './utils/payment-status.mapper';
import {
  Order,
  OrderDocument,
} from '../orders/schemas/order.schema';
import {
  CampaignStatus,
  Raffle,
  RaffleDocument,
} from '../riffles/schema/raffle.schema';
import {
  PrizeAward,
  PrizeAwardDocument,
  PrizeAwardStatus,
} from '../prizes/schemas/prize-award.schema';

export interface PaymentLifecycleEvent {
  paymentId: string;
  orderId: string;
  campaignId: string;
  userId?: string;
  provider: PaymentProviderName;
  previousStatus: PaymentStatus;
  status: PaymentStatus;
  source: PaymentEventSource;
  amount: number;
  currency: PaymentCurrency;
  txid: string;
  endToEndId?: string;
}

/**
 * OrdersService debe registrar una implementación al arrancar mediante
 * registerLifecycleHooks(). Los callbacks deben ser idempotentes por paymentId.
 */
export interface PaymentLifecycleHooks {
  onPaymentStatusChanged?(event: PaymentLifecycleEvent): Promise<void> | void;
  onPaymentPaid?(event: PaymentLifecycleEvent): Promise<void> | void;
  onPaymentCancelled?(event: PaymentLifecycleEvent): Promise<void> | void;
  onPaymentRefunded?(event: PaymentLifecycleEvent): Promise<void> | void;
}

export interface CreatePaymentResult {
  payment: PaymentDocument;
  accessSecret: string;
  idempotentReplay: boolean;
}

export interface PublicPaymentView {
  id: string;
  status: PaymentStatus;
  provider: PaymentProviderName;
  txid: string;
  amount: number;
  currency: PaymentCurrency;
  qrCode?: string;
  qrCodeImage?: string;
  pixCopyPaste?: string;
  checkoutUrl?: string;
  expiresAt: Date;
  paidAt?: Date;
  cancelledAt?: Date;
  refundedAt?: Date;
  refundedAmount: number;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface WebhookProcessingResult {
  accepted: true;
  processed: number;
  duplicates: number;
  unknownPayments: number;
  ignored: number;
}

const ALLOWED_TRANSITIONS: Record<PaymentStatus, ReadonlySet<PaymentStatus>> = {
  [PaymentStatus.Created]: new Set([
    PaymentStatus.Pending,
    PaymentStatus.Active,
    PaymentStatus.Paid,
    PaymentStatus.Expired,
    PaymentStatus.Cancelled,
    PaymentStatus.Rejected,
    PaymentStatus.Failed,
    PaymentStatus.UnderReview,
  ]),
  [PaymentStatus.Pending]: new Set([
    PaymentStatus.Active,
    PaymentStatus.Paid,
    PaymentStatus.Expired,
    PaymentStatus.Cancelled,
    PaymentStatus.Rejected,
    PaymentStatus.Failed,
    PaymentStatus.UnderReview,
  ]),
  [PaymentStatus.Active]: new Set([
    PaymentStatus.Paid,
    PaymentStatus.Expired,
    PaymentStatus.Cancelled,
    PaymentStatus.Rejected,
    PaymentStatus.Failed,
    PaymentStatus.UnderReview,
  ]),
  [PaymentStatus.Paid]: new Set([
    PaymentStatus.RefundPending,
    PaymentStatus.PartiallyRefunded,
    PaymentStatus.Refunded,
    PaymentStatus.UnderReview,
    PaymentStatus.Disputed,
    PaymentStatus.Chargeback,
  ]),
  [PaymentStatus.Expired]: new Set([PaymentStatus.Paid]),
  [PaymentStatus.Cancelled]: new Set([PaymentStatus.Paid]),
  [PaymentStatus.Rejected]: new Set([PaymentStatus.Active, PaymentStatus.Paid]),
  [PaymentStatus.Failed]: new Set([
    PaymentStatus.Pending,
    PaymentStatus.Active,
    PaymentStatus.Paid,
    PaymentStatus.Expired,
    PaymentStatus.Cancelled,
    PaymentStatus.Rejected,
    PaymentStatus.UnderReview,
  ]),
  [PaymentStatus.RefundPending]: new Set([
    PaymentStatus.Paid,
    PaymentStatus.PartiallyRefunded,
    PaymentStatus.Refunded,
    PaymentStatus.UnderReview,
  ]),
  [PaymentStatus.PartiallyRefunded]: new Set([
    PaymentStatus.RefundPending,
    PaymentStatus.Refunded,
    PaymentStatus.Disputed,
    PaymentStatus.Chargeback,
  ]),
  [PaymentStatus.Refunded]: new Set([
    PaymentStatus.Disputed,
    PaymentStatus.Chargeback,
  ]),
  [PaymentStatus.UnderReview]: new Set([
    PaymentStatus.Active,
    PaymentStatus.Paid,
    PaymentStatus.Cancelled,
    PaymentStatus.Rejected,
    PaymentStatus.RefundPending,
    PaymentStatus.PartiallyRefunded,
    PaymentStatus.Refunded,
    PaymentStatus.Disputed,
    PaymentStatus.Chargeback,
  ]),
  [PaymentStatus.Disputed]: new Set([
    PaymentStatus.Paid,
    PaymentStatus.PartiallyRefunded,
    PaymentStatus.Refunded,
    PaymentStatus.Chargeback,
  ]),
  [PaymentStatus.Chargeback]: new Set(),
};

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);
  private readonly lifecycleHooks = new Set<PaymentLifecycleHooks>();

  constructor(
    @InjectModel(Payment.name)
    private readonly paymentModel: Model<Payment>,
    private readonly providerFactory: PaymentProviderFactory,
    private readonly config: ConfigService,
    @Optional()
    @InjectModel(Order.name)
    private readonly orderModel?: Model<OrderDocument>,
    @Optional()
    @InjectModel(Raffle.name)
    private readonly campaignModel?: Model<RaffleDocument>,
    @Optional()
    @InjectModel(PrizeAward.name)
    private readonly awardModel?: Model<PrizeAwardDocument>,
  ) {}

  registerLifecycleHooks(hooks: PaymentLifecycleHooks): () => void {
    this.lifecycleHooks.add(hooks);
    return () => this.lifecycleHooks.delete(hooks);
  }

  async create(dto: CreatePaymentDto): Promise<CreatePaymentResult> {
    this.validateCreateInput(dto);
    const amount = this.normalizeAmount(dto.amount);
    const provider = this.providerFactory.get(dto.provider);
    const accessSecret = this.deriveAccessSecret(dto.idempotencyKey);
    const existing = await this.paymentModel
      .findOne({ idempotencyKey: dto.idempotencyKey })
      .exec();
    if (existing) {
      this.assertIdempotentRequest(existing, dto, amount, provider.name);
      const resumed = await this.ensureProviderPayment(
        existing,
        dto,
        provider,
        true,
      );
      return { payment: resumed, accessSecret, idempotentReplay: true };
    }

    const expiresInSeconds =
      dto.expiresInSeconds ?? DEFAULT_PAYMENT_EXPIRATION_SECONDS;
    const txid = this.createTxid(dto.idempotencyKey);
    let payment: PaymentDocument;
    try {
      payment = await this.paymentModel.create({
        order: new Types.ObjectId(dto.orderId),
        campaign: new Types.ObjectId(dto.campaignId),
        ...(dto.userId ? { user: new Types.ObjectId(dto.userId) } : {}),
        amount,
        currency: dto.currency ?? PaymentCurrency.BRL,
        provider: provider.name,
        txid,
        idempotencyKey: dto.idempotencyKey,
        publicSecretHash: this.hashSecret(accessSecret),
        expiresAt: new Date(Date.now() + expiresInSeconds * 1000),
        status: PaymentStatus.Created,
        statusHistory: [
          {
            status: PaymentStatus.Created,
            source: PaymentEventSource.Application,
            occurredAt: new Date(),
          },
        ],
      });
    } catch (error) {
      if (!this.isDuplicateKeyError(error)) throw error;
      const replay = await this.paymentModel
        .findOne({ idempotencyKey: dto.idempotencyKey })
        .exec();
      if (!replay) throw error;
      this.assertIdempotentRequest(replay, dto, amount, provider.name);
      const resumed = await this.ensureProviderPayment(
        replay,
        dto,
        provider,
        true,
      );
      return { payment: resumed, accessSecret, idempotentReplay: true };
    }

    payment = await this.ensureProviderPayment(payment, dto, provider);
    return { payment, accessSecret, idempotentReplay: false };
  }

  async findById(id: string): Promise<PaymentDocument> {
    this.validateId(id);
    const payment = await this.paymentModel.findById(id).exec();
    if (!payment) throw new NotFoundException('Pago no encontrado');
    return payment;
  }

  async findByIdempotencyKey(
    idempotencyKey: string,
  ): Promise<PaymentDocument | null> {
    return this.paymentModel.findOne({ idempotencyKey }).exec();
  }

  async findAll(
    status?: PaymentStatus,
    page = 1,
    limit = 50,
  ): Promise<{ data: PaymentDocument[]; page: number; limit: number }> {
    if (status && !Object.values(PaymentStatus).includes(status)) {
      throw new BadRequestException(`Estado de pago inválido: ${status}`);
    }
    const safePage = Math.max(1, Math.floor(page));
    const safeLimit = Math.min(200, Math.max(1, Math.floor(limit)));
    const data = await this.paymentModel
      .find(status ? { status } : {})
      .sort({ createdAt: -1 })
      .skip((safePage - 1) * safeLimit)
      .limit(safeLimit)
      .exec();
    return { data, page: safePage, limit: safeLimit };
  }

  async findPublic(
    id: string,
    accessSecret: string,
  ): Promise<PublicPaymentView> {
    this.validateId(id);
    const payment = await this.paymentModel
      .findById(id)
      .select('+publicSecretHash')
      .exec();
    if (
      !payment ||
      !this.secretMatches(payment.publicSecretHash, accessSecret)
    ) {
      throw new UnauthorizedException('Pago o secreto de acceso inválido');
    }
    return this.toPublicView(payment);
  }

  async getStatus(id: string): Promise<PaymentStatus> {
    return (await this.findById(id)).status;
  }

  async retryLifecycleHooks(id: string): Promise<PaymentDocument> {
    const payment = await this.findById(id);
    if (this.lifecycleHooks.size === 0) {
      throw new ServiceUnavailableException(
        'OrdersService todavía no registró callbacks de ciclo de vida',
      );
    }
    await this.notifyLifecycle(
      payment,
      payment.status,
      PaymentEventSource.Reconciliation,
    );
    return this.findById(id);
  }

  async updateStatus(
    id: string,
    status: PaymentStatus,
    reason?: string,
  ): Promise<PaymentDocument> {
    const payment = await this.findById(id);
    await this.transition(payment, status, PaymentEventSource.Admin, reason);
    return payment;
  }

  async reconcile(id: string): Promise<PaymentDocument> {
    const payment = await this.findById(id);
    const provider = this.providerFactory.get(payment.provider);
    const result = await provider.findPayment({
      txid: payment.txid,
      externalId: payment.externalId,
    });
    if (
      [PaymentStatus.Active, PaymentStatus.Pending].includes(result.status) &&
      payment.expiresAt.getTime() <= Date.now()
    ) {
      result.status = PaymentStatus.Expired;
    }
    await this.applyProviderResult(
      payment,
      result,
      PaymentEventSource.Reconciliation,
    );
    return payment;
  }

  async cancel(id: string, reason?: string): Promise<PaymentDocument> {
    const payment = await this.findById(id);
    if (
      ![
        PaymentStatus.Created,
        PaymentStatus.Pending,
        PaymentStatus.Active,
        PaymentStatus.Failed,
      ].includes(payment.status)
    ) {
      throw new ConflictException(
        `No se puede cancelar un pago en estado ${payment.status}`,
      );
    }
    const provider = this.providerFactory.get(payment.provider);
    const result = await provider.cancelPayment({
      txid: payment.txid,
      externalId: payment.externalId,
      reason,
    });
    await this.applyProviderResult(
      payment,
      result,
      PaymentEventSource.Provider,
      reason,
    );
    return payment;
  }

  async refund(id: string, dto: RefundPaymentDto): Promise<PaymentDocument> {
    if (!/^[A-Za-z0-9._:-]{8,128}$/.test(dto.idempotencyKey)) {
      throw new BadRequestException('Clave idempotente de devolución inválida');
    }
    const payment = await this.findById(id);
    await this.assertRefundAllowed(payment);
    if (
      ![
        PaymentStatus.Paid,
        PaymentStatus.PartiallyRefunded,
        PaymentStatus.RefundPending,
      ].includes(payment.status)
    ) {
      throw new ConflictException(
        `No se puede devolver un pago en estado ${payment.status}`,
      );
    }
    const previousRefund = payment.refunds.find(
      (refund) => refund.idempotencyKey === dto.idempotencyKey,
    );
    if (previousRefund) return payment;
    if (!payment.endToEndId) {
      throw new ConflictException(
        'El pago no tiene endToEndId; reconcilie el pago antes de devolverlo',
      );
    }
    const refundable = this.normalizeAmount(
      payment.amount - (payment.refundedAmount ?? 0),
    );
    const amount = this.normalizeAmount(dto.amount ?? refundable);
    if (amount > refundable) {
      throw new BadRequestException(
        `El máximo reembolsable es ${refundable.toFixed(2)} ${payment.currency}`,
      );
    }
    const provider = this.providerFactory.get(payment.provider);
    const result = await provider.refundPayment({
      txid: payment.txid,
      externalId: payment.externalId,
      endToEndId: payment.endToEndId,
      amount,
      idempotencyKey: dto.idempotencyKey,
    });
    const refund: PaymentRefund = {
      idempotencyKey: dto.idempotencyKey,
      providerRefundId: result.providerRefundId,
      amount,
      status: result.status,
      providerPayload: result.raw
        ? this.boundedProviderPayload(result.raw)
        : undefined,
      requestedAt: new Date(),
      completedAt:
        result.status === PaymentStatus.Refunded ? new Date() : undefined,
    };
    payment.refunds.push(refund);
    if (result.status === PaymentStatus.Refunded) {
      payment.refundedAmount = this.normalizeAmount(
        (payment.refundedAmount ?? 0) + amount,
      );
    }
    const nextStatus =
      result.status === PaymentStatus.Refunded &&
      payment.refundedAmount < payment.amount
        ? PaymentStatus.PartiallyRefunded
        : result.status;
    await this.transition(
      payment,
      nextStatus,
      PaymentEventSource.Provider,
      dto.reason,
      result.raw,
    );
    return payment;
  }

  async expireDuePayments(): Promise<number> {
    const due = await this.paymentModel
      .find({
        status: {
          $in: [
            PaymentStatus.Created,
            PaymentStatus.Pending,
            PaymentStatus.Active,
          ],
        },
        expiresAt: { $lte: new Date() },
      })
      .exec();
    for (const payment of due) {
      await this.transition(
        payment,
        PaymentStatus.Expired,
        PaymentEventSource.Application,
        'La ventana de pago venció',
      );
    }
    return due.length;
  }

  async processWebhook(
    providerName: PaymentProviderName,
    payload: Record<string, unknown>,
  ): Promise<WebhookProcessingResult> {
    this.providerFactory.get(providerName);
    const events = this.extractWebhookEvents(providerName, payload);
    const result: WebhookProcessingResult = {
      accepted: true,
      processed: 0,
      duplicates: 0,
      unknownPayments: 0,
      ignored: 0,
    };

    for (const event of events) {
      if (!event.txid) {
        result.ignored += 1;
        continue;
      }
      const payment = await this.paymentModel
        .findOne({ provider: providerName, txid: event.txid })
        .exec();
      if (!payment) {
        result.unknownPayments += 1;
        continue;
      }
      const fingerprint = createHash('sha256')
        .update(`${providerName}:${stableStringify(event.raw)}`)
        .digest('hex');
      const persistedPayload = this.boundedProviderPayload(event.raw);
      const inserted = await this.paymentModel.updateOne(
        {
          _id: payment._id,
          'webhookPayloads.fingerprint': { $ne: fingerprint },
        },
        {
          $push: {
            webhookPayloads: {
              $each: [
                {
                  fingerprint,
                  eventId: event.eventId,
                  provider: providerName,
                  payload: persistedPayload,
                  receivedAt: new Date(),
                },
              ],
              $slice: -200,
            },
          },
        },
      );
      if (inserted.modifiedCount === 0) {
        result.duplicates += 1;
        continue;
      }

      try {
        const fresh = await this.findById(payment._id.toString());
        if (event.endToEndId) fresh.endToEndId = event.endToEndId;
        if (event.refundedAmount !== undefined) {
          fresh.refundedAmount = Math.min(
            fresh.amount,
            this.normalizeAmount(event.refundedAmount),
          );
        }
        fresh.providerPayload = persistedPayload;
        const webhookStatus =
          event.status === PaymentStatus.PartiallyRefunded &&
          fresh.refundedAmount >= fresh.amount
            ? PaymentStatus.Refunded
            : event.status;
        if (
          [
            PaymentStatus.RefundPending,
            PaymentStatus.PartiallyRefunded,
            PaymentStatus.Refunded,
          ].includes(webhookStatus) &&
          ![
            PaymentStatus.Paid,
            PaymentStatus.RefundPending,
            PaymentStatus.PartiallyRefunded,
            PaymentStatus.Refunded,
          ].includes(fresh.status)
        ) {
          await this.transition(
            fresh,
            PaymentStatus.Paid,
            PaymentEventSource.Webhook,
            'Pix recibido antes de la notificación de devolución',
            persistedPayload,
          );
        }
        await this.transition(
          fresh,
          webhookStatus,
          PaymentEventSource.Webhook,
          undefined,
          persistedPayload,
        );
        await this.paymentModel.updateOne(
          { _id: payment._id },
          {
            $set: {
              'webhookPayloads.$[webhook].processedAt': new Date(),
            },
          },
          { arrayFilters: [{ 'webhook.fingerprint': fingerprint }] },
        );
        result.processed += 1;
      } catch (error) {
        await this.paymentModel
          .updateOne(
            { _id: payment._id },
            { $pull: { webhookPayloads: { fingerprint } } },
          )
          .catch(() => undefined);
        throw error;
      }
    }
    return result;
  }

  toPublicView(payment: PaymentDocument): PublicPaymentView {
    return {
      id: payment._id.toString(),
      status: payment.status,
      provider: payment.provider,
      txid: payment.txid,
      amount: payment.amount,
      currency: payment.currency,
      qrCode: payment.qrCode,
      qrCodeImage: payment.qrCodeImage,
      pixCopyPaste: payment.pixCopyPaste,
      checkoutUrl: payment.checkoutUrl,
      expiresAt: payment.expiresAt,
      paidAt: payment.paidAt,
      cancelledAt: payment.cancelledAt,
      refundedAt: payment.refundedAt,
      refundedAmount: payment.refundedAmount ?? 0,
      createdAt: payment.createdAt,
      updatedAt: payment.updatedAt,
    };
  }

  toAdminView(payment: PaymentDocument): Record<string, unknown> {
    const value = payment.toObject() as unknown as Record<string, unknown>;
    delete value.publicSecretHash;
    return value;
  }

  private async ensureProviderPayment(
    payment: PaymentDocument,
    dto: CreatePaymentDto,
    provider: PaymentProvider,
    waitForConcurrentRequest = false,
  ): Promise<PaymentDocument> {
    if (payment.status === PaymentStatus.Created) {
      if (waitForConcurrentRequest) {
        const completedByConcurrentRequest = await this.waitForCreation(
          payment._id.toString(),
        );
        if (completedByConcurrentRequest.status !== PaymentStatus.Created) {
          return completedByConcurrentRequest;
        }
        payment = completedByConcurrentRequest;
      }
    } else if (payment.status !== PaymentStatus.Failed) {
      return payment;
    }

    const expiresInSeconds = Math.max(
      MIN_PAYMENT_EXPIRATION_SECONDS,
      Math.ceil((payment.expiresAt.getTime() - Date.now()) / 1000),
    );
    try {
      const result = await provider.createPayment({
        txid: payment.txid,
        amount: payment.amount,
        currency: payment.currency,
        expiresInSeconds,
        description: dto.description,
        payer: dto.payer,
        idempotencyKey: dto.idempotencyKey,
      });
      await this.applyProviderResult(
        payment,
        result,
        PaymentEventSource.Provider,
      );
      return payment;
    } catch (error) {
      if (error instanceof PaymentProviderError && error.statusCode === 409) {
        try {
          const reconciled = await provider.findPayment({
            txid: payment.txid,
            externalId: payment.externalId,
          });
          await this.applyProviderResult(
            payment,
            reconciled,
            PaymentEventSource.Reconciliation,
          );
          return payment;
        } catch {
          // Conserva el error de creación original si la conciliación falla.
        }
      }
      const latest = await this.paymentModel.findById(payment._id).exec();
      if (
        latest &&
        ![PaymentStatus.Created, PaymentStatus.Failed].includes(latest.status)
      ) {
        return latest;
      }
      payment = latest ?? payment;
      payment.providerError = this.providerErrorMessage(error);
      if (payment.status !== PaymentStatus.Failed) {
        await this.transition(
          payment,
          PaymentStatus.Failed,
          PaymentEventSource.Provider,
          payment.providerError,
        );
      } else {
        await payment.save();
      }
      throw error;
    }
  }

  private async waitForCreation(id: string): Promise<PaymentDocument> {
    let payment = await this.findById(id);
    for (
      let attempt = 0;
      attempt < 15 && payment.status === PaymentStatus.Created;
      attempt += 1
    ) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      payment = await this.findById(id);
    }
    return payment;
  }

  private async applyProviderResult(
    payment: PaymentDocument,
    result: ProviderPaymentResult,
    source: PaymentEventSource,
    reason?: string,
  ): Promise<void> {
    payment.externalId = result.externalId ?? payment.externalId;
    payment.txid = result.txid || payment.txid;
    payment.endToEndId = result.endToEndId ?? payment.endToEndId;
    payment.qrCode = result.qrCode ?? payment.qrCode;
    payment.qrCodeImage = result.qrCodeImage ?? payment.qrCodeImage;
    payment.pixCopyPaste = result.pixCopyPaste ?? payment.pixCopyPaste;
    payment.checkoutUrl = result.checkoutUrl ?? payment.checkoutUrl;
    payment.providerPayload = result.raw
      ? this.boundedProviderPayload(result.raw)
      : undefined;
    payment.providerError = undefined;

    if (
      [PaymentStatus.Paid, PaymentStatus.PartiallyRefunded].includes(
        payment.status,
      ) &&
      [PaymentStatus.Pending, PaymentStatus.Active].includes(result.status)
    ) {
      await payment.save();
      return;
    }
    await this.transition(
      payment,
      result.status,
      source,
      reason,
      payment.providerPayload,
    );
  }

  private async transition(
    payment: PaymentDocument,
    status: PaymentStatus,
    source: PaymentEventSource,
    reason?: string,
    metadata?: Record<string, unknown>,
  ): Promise<void> {
    const previousStatus = payment.status;
    if (previousStatus === status) {
      await payment.save();
      return;
    }
    if (!ALLOWED_TRANSITIONS[previousStatus]?.has(status)) {
      throw new ConflictException(
        `Transición de pago inválida: ${previousStatus} -> ${status}`,
      );
    }
    payment.status = status;
    payment.statusHistory.push({
      status,
      source,
      reason,
      metadata,
      occurredAt: new Date(),
    } as PaymentStatusHistoryEntry);
    const now = new Date();
    if (status === PaymentStatus.Paid) payment.paidAt = payment.paidAt ?? now;
    if (status === PaymentStatus.Cancelled) payment.cancelledAt = now;
    if (status === PaymentStatus.Refunded) payment.refundedAt = now;
    await payment.save();
    await this.notifyLifecycle(payment, previousStatus, source);
  }

  private async notifyLifecycle(
    payment: PaymentDocument,
    previousStatus: PaymentStatus,
    source: PaymentEventSource,
  ): Promise<void> {
    if (this.lifecycleHooks.size === 0) return;
    const event: PaymentLifecycleEvent = {
      paymentId: payment._id.toString(),
      orderId: payment.order.toString(),
      campaignId: payment.campaign.toString(),
      userId: payment.user?.toString(),
      provider: payment.provider,
      previousStatus,
      status: payment.status,
      source,
      amount: payment.amount,
      currency: payment.currency,
      txid: payment.txid,
      endToEndId: payment.endToEndId,
    };
    const errors: string[] = [];
    for (const hooks of this.lifecycleHooks) {
      try {
        await hooks.onPaymentStatusChanged?.(event);
        if (payment.status === PaymentStatus.Paid) {
          await hooks.onPaymentPaid?.(event);
        }
        if (
          [PaymentStatus.Cancelled, PaymentStatus.Expired].includes(
            payment.status,
          )
        ) {
          await hooks.onPaymentCancelled?.(event);
        }
        if (
          [PaymentStatus.PartiallyRefunded, PaymentStatus.Refunded].includes(
            payment.status,
          )
        ) {
          await hooks.onPaymentRefunded?.(event);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        errors.push(message);
        this.logger.error(
          `Falló callback para pago ${payment._id}: ${message}`,
        );
      }
    }
    if (errors.length === 0) {
      await this.paymentModel.updateOne(
        { _id: payment._id },
        {
          $unset: { lifecycleHookError: 1 },
          $set: { lifecycleHookProcessedAt: new Date() },
        },
      );
    } else {
      await this.paymentModel.updateOne(
        { _id: payment._id },
        { $set: { lifecycleHookError: errors.join(' | ').slice(0, 2000) } },
      );
    }
  }

  private extractWebhookEvents(
    providerName: PaymentProviderName,
    payload: Record<string, unknown>,
  ): Array<{
    txid?: string;
    eventId?: string;
    endToEndId?: string;
    status: PaymentStatus;
    refundedAmount?: number;
    raw: Record<string, unknown>;
  }> {
    if (providerName === PaymentProviderName.Mock) {
      const status = payload.status as PaymentStatus;
      if (!Object.values(PaymentStatus).includes(status)) {
        throw new BadRequestException('Status inválido en webhook mock');
      }
      return [
        {
          txid: typeof payload.txid === 'string' ? payload.txid : undefined,
          eventId:
            typeof payload.eventId === 'string' ? payload.eventId : undefined,
          endToEndId:
            typeof payload.endToEndId === 'string'
              ? payload.endToEndId
              : undefined,
          status,
          raw: payload,
        },
      ];
    }

    const pix = Array.isArray(payload.pix) ? payload.pix : [];
    return pix
      .filter((item): item is Record<string, unknown> =>
        Boolean(item && typeof item === 'object'),
      )
      .map((item) => {
        const refunds = Array.isArray(item.devolucoes)
          ? (item.devolucoes as Record<string, unknown>[])
          : [];
        const completedRefunds = refunds.filter(
          (refund) => String(refund.status).toUpperCase() === 'DEVOLVIDO',
        );
        const pendingRefund = refunds.some(
          (refund) =>
            mapEfiRefundStatus(String(refund.status)) ===
            PaymentStatus.RefundPending,
        );
        const refundedAmount = completedRefunds.reduce(
          (sum, refund) => sum + Number(refund.valor ?? 0),
          0,
        );
        let status = PaymentStatus.Paid;
        if (pendingRefund) status = PaymentStatus.RefundPending;
        else if (refundedAmount > 0) status = PaymentStatus.PartiallyRefunded;
        return {
          txid: typeof item.txid === 'string' ? item.txid : undefined,
          eventId:
            typeof item.endToEndId === 'string'
              ? `${item.endToEndId}:${refunds
                  .map((refund) => `${refund.id ?? ''}:${refund.status ?? ''}`)
                  .join(',')}`
              : undefined,
          endToEndId:
            typeof item.endToEndId === 'string' ? item.endToEndId : undefined,
          status,
          refundedAmount: refundedAmount || undefined,
          raw: item,
        };
      });
  }

  private validateCreateInput(dto: CreatePaymentDto): void {
    for (const [name, value] of [
      ['orderId', dto.orderId],
      ['campaignId', dto.campaignId],
      ...(dto.userId ? ([['userId', dto.userId]] as const) : []),
    ]) {
      if (!Types.ObjectId.isValid(value)) {
        throw new BadRequestException(`${name} inválido`);
      }
    }
    if (!/^[A-Za-z0-9._:-]{8,128}$/.test(dto.idempotencyKey)) {
      throw new BadRequestException('Clave idempotente de pago inválida');
    }
    if (dto.currency && dto.currency !== PaymentCurrency.BRL) {
      throw new BadRequestException('Este módulo de Pix solo admite BRL');
    }
    const expiresInSeconds =
      dto.expiresInSeconds ?? DEFAULT_PAYMENT_EXPIRATION_SECONDS;
    if (
      !Number.isInteger(expiresInSeconds) ||
      expiresInSeconds < MIN_PAYMENT_EXPIRATION_SECONDS ||
      expiresInSeconds > MAX_PAYMENT_EXPIRATION_SECONDS
    ) {
      throw new BadRequestException('Tiempo de expiración de pago inválido');
    }
    if (dto.payer?.cpf && dto.payer.cnpj) {
      throw new BadRequestException(
        'El pagador no puede tener CPF y CNPJ a la vez',
      );
    }
  }

  private validateId(id: string): void {
    if (!Types.ObjectId.isValid(id)) {
      throw new BadRequestException('ID de pago inválido');
    }
  }

  private normalizeAmount(amount: number): number {
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new BadRequestException('El importe debe ser mayor que cero');
    }
    const normalized = Math.round((amount + Number.EPSILON) * 100) / 100;
    if (Math.abs(normalized - amount) > Number.EPSILON * 100) {
      throw new BadRequestException(
        'El importe admite como máximo 2 decimales',
      );
    }
    return normalized;
  }

  private assertIdempotentRequest(
    payment: PaymentDocument,
    dto: CreatePaymentDto,
    amount: number,
    provider: PaymentProviderName,
  ): void {
    const same =
      payment.order.toString() === dto.orderId &&
      payment.campaign.toString() === dto.campaignId &&
      payment.user?.toString() === dto.userId &&
      payment.amount === amount &&
      payment.currency === (dto.currency ?? PaymentCurrency.BRL) &&
      payment.provider === provider;
    if (!same) {
      throw new ConflictException(
        'La clave idempotente ya se usó con otros datos',
      );
    }
  }

  private deriveAccessSecret(idempotencyKey: string): string {
    let key = this.config.get<string>('PAYMENTS_PUBLIC_SECRET_KEY');
    if (!key) {
      if (
        (this.config.get<string>('NODE_ENV') ?? process.env.NODE_ENV) ===
        'production'
      ) {
        throw new ServiceUnavailableException(
          'Configure PAYMENTS_PUBLIC_SECRET_KEY antes de crear pagos',
        );
      }
      key = 'development-only-payments-secret-change-before-production';
    }
    return createHmac('sha256', key).update(idempotencyKey).digest('base64url');
  }

  private hashSecret(secret: string): string {
    return createHash('sha256').update(secret).digest('hex');
  }

  private secretMatches(expectedHash: string, secret: string): boolean {
    if (!expectedHash || !secret) return false;
    const received = Buffer.from(this.hashSecret(secret));
    const expected = Buffer.from(expectedHash);
    return (
      received.length === expected.length && timingSafeEqual(received, expected)
    );
  }

  private createTxid(idempotencyKey: string): string {
    return createHash('sha256')
      .update(`raffle-payment:${idempotencyKey}`)
      .digest('hex')
      .slice(0, 32);
  }

  private providerErrorMessage(error: unknown): string {
    if (error instanceof PaymentProviderError) {
      return `${error.provider}: ${error.message}`;
    }
    return error instanceof Error ? error.message : String(error);
  }

  private boundedProviderPayload(
    payload: Record<string, unknown>,
  ): Record<string, unknown> {
    const serialized = stableStringify(payload);
    const bytes = Buffer.byteLength(serialized, 'utf8');
    if (bytes <= 16_384) return payload;
    return {
      truncated: true,
      sha256: createHash('sha256').update(serialized).digest('hex'),
      originalBytes: bytes,
      topLevelKeys: Object.keys(payload).slice(0, 50),
    };
  }

  private async assertRefundAllowed(payment: PaymentDocument): Promise<void> {
    if (!this.orderModel || !this.campaignModel || !this.awardModel) return;
    const [order, campaign, fulfilledAward] = await Promise.all([
      this.orderModel
        .findById(payment.order)
        .select('titleNumbers')
        .lean(),
      this.campaignModel
        .findById(payment.campaign)
        .select('status winningQuotaNumber')
        .lean(),
      this.awardModel
        .findOne({
          order: payment.order,
          status: PrizeAwardStatus.Fulfilled,
        })
        .select('_id')
        .lean(),
    ]);
    if (fulfilledAward) {
      throw new ConflictException(
        'No se puede automatizar la devolución de un pedido con premios ya entregados',
      );
    }
    if (
      order &&
      campaign?.winningQuotaNumber &&
      [CampaignStatus.Drawn, CampaignStatus.Closed].includes(campaign.status) &&
      order.titleNumbers?.includes(campaign.winningQuotaNumber)
    ) {
      throw new ConflictException(
        'No se puede devolver automáticamente el pedido ganador después de publicar el resultado',
      );
    }
  }

  private isDuplicateKeyError(error: unknown): boolean {
    return Boolean(
      error &&
      typeof error === 'object' &&
      'code' in error &&
      (error as { code?: number }).code === 11000,
    );
  }
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}
