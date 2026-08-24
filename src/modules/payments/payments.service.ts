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
import { Cron } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { createHash, createHmac, randomUUID, timingSafeEqual } from 'crypto';
import { ClientSession, Connection, Model, Types } from 'mongoose';
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
  PaymentProviderRefund,
  PaymentRefund,
  PaymentReceipt,
  PaymentStatusHistoryEntry,
} from './schemas/payment.schema';
import {
  PaymentOutboxDocument,
  PaymentOutboxEvent,
  PaymentOutboxStatus,
} from './schemas/payment-outbox.schema';
import {
  RefundAllocation,
  RefundOperation,
  RefundOperationDocument,
  RefundOperationStatus,
} from './schemas/refund-operation.schema';
import {
  centsToAmount,
  mergePixReceipts,
  PixReceiptSnapshot,
  PixRefundSnapshot,
  summarizeEfiPixEntries,
} from './payment-finance';
import { Order, OrderDocument } from '../orders/schemas/order.schema';
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
import {
  Quota,
  QuotaDocument,
  QuotaStatus,
} from '../orders/schemas/quota.schema';
import { OrderStatus } from '../orders/schemas/order.schema';

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
  receivedAmount: number;
  createdAt?: Date;
  updatedAt?: Date;
}

interface PaymentMutationPatch {
  externalId?: string;
  txid?: string;
  qrCode?: string;
  qrCodeImage?: string;
  pixCopyPaste?: string;
  checkoutUrl?: string;
  providerPayload?: Record<string, unknown>;
  providerError?: string;
  legacyEndToEndId?: string;
  paidAt?: Date;
  receipts?: PixReceiptSnapshot[];
  refunds?: PixRefundSnapshot[];
  receiptIntegrityError?: string;
  enforceExactReceiptAmount?: boolean;
  authoritativeRefundedAmountCents?: number;
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
  [PaymentStatus.Expired]: new Set([
    PaymentStatus.Paid,
    PaymentStatus.UnderReview,
  ]),
  [PaymentStatus.Cancelled]: new Set([
    PaymentStatus.Paid,
    PaymentStatus.UnderReview,
  ]),
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

const EXPIRABLE_PAYMENT_STATUSES: readonly PaymentStatus[] = [
  PaymentStatus.Created,
  PaymentStatus.Pending,
  PaymentStatus.Active,
];

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);
  private readonly lifecycleHooks = new Map<string, PaymentLifecycleHooks>();

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
    @Optional()
    @InjectConnection()
    private readonly connection?: Connection,
    @Optional()
    @InjectModel(PaymentOutboxEvent.name)
    private readonly outboxModel?: Model<PaymentOutboxEvent>,
    @Optional()
    @InjectModel(RefundOperation.name)
    private readonly refundOperationModel?: Model<RefundOperation>,
    @Optional()
    @InjectModel(Quota.name)
    private readonly quotaModel?: Model<QuotaDocument>,
  ) {}

  registerLifecycleHooks(hooks: PaymentLifecycleHooks): () => void {
    const baseName = hooks.constructor?.name || 'PaymentLifecycleHooks';
    let hookId = baseName;
    let suffix = 2;
    while (this.lifecycleHooks.has(hookId)) {
      hookId = `${baseName}#${suffix}`;
      suffix += 1;
    }
    this.lifecycleHooks.set(hookId, hooks);
    return () => this.lifecycleHooks.delete(hookId);
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
        amountCents: this.toCents(amount),
        receivedAmountCents: 0,
        refundedAmountCents: 0,
        refundReservedAmountCents: 0,
        currency: dto.currency ?? PaymentCurrency.BRL,
        provider: provider.name,
        txid,
        idempotencyKey: dto.idempotencyKey,
        publicSecretHash: this.hashSecret(accessSecret),
        expiresAt: new Date(Date.now() + expiresInSeconds * 1000),
        status: PaymentStatus.Created,
        transitionSequence: 0,
        receipts: [],
        providerRefunds: [],
        endToEndIds: [],
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
    if (!this.outboxModel) {
      await this.notifyLifecycleDirect(
        payment,
        payment.status,
        PaymentEventSource.Reconciliation,
      );
      return this.findById(id);
    }
    const latest = await this.outboxModel
      .findOne({ payment: payment._id, status: payment.status })
      .sort({ sequence: -1, createdAt: -1 })
      .exec();
    if (latest) {
      if (
        latest.outboxStatus === PaymentOutboxStatus.Processing &&
        latest.lockedAt &&
        latest.lockedAt.getTime() >
          Date.now() - this.outboxLockTimeoutSeconds() * 1000
      ) {
        throw new ConflictException(
          'El evento de lifecycle ya está siendo procesado',
        );
      }
      latest.outboxStatus = PaymentOutboxStatus.Pending;
      latest.completedSteps = [];
      latest.attempts = 0;
      latest.nextAttemptAt = new Date();
      latest.lockedAt = undefined;
      latest.completedAt = undefined;
      latest.lastError = undefined;
      await latest.save();
    } else {
      await this.outboxModel.create({
        eventKey: `${payment._id.toString()}:replay:${randomUUID()}`,
        payment: payment._id,
        sequence: Math.max(1, payment.transitionSequence ?? 1),
        orderId: payment.order.toString(),
        campaignId: payment.campaign.toString(),
        userId: payment.user?.toString(),
        provider: payment.provider,
        previousStatus: payment.status,
        status: payment.status,
        source: PaymentEventSource.Reconciliation,
        amountCents: this.paymentAmountCents(payment),
        currency: payment.currency,
        txid: payment.txid,
        endToEndId: payment.endToEndId,
        outboxStatus: PaymentOutboxStatus.Pending,
        nextAttemptAt: new Date(),
      });
    }
    await this.processOutboxForPayment(id);
    return this.findById(id);
  }

  async updateStatus(
    id: string,
    status: PaymentStatus,
    reason?: string,
  ): Promise<PaymentDocument> {
    if (
      [
        PaymentStatus.Paid,
        PaymentStatus.RefundPending,
        PaymentStatus.PartiallyRefunded,
        PaymentStatus.Refunded,
      ].includes(status)
    ) {
      throw new BadRequestException(
        'Los estados con movimiento de dinero solo pueden provenir del PSP, webhook o conciliación',
      );
    }
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
    const reconciledResult = {
      ...result,
      status:
        [PaymentStatus.Active, PaymentStatus.Pending].includes(result.status) &&
        payment.expiresAt.getTime() <= Date.now()
          ? PaymentStatus.Expired
          : result.status,
    };
    await this.applyProviderResult(
      payment,
      reconciledResult,
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
    if (!this.connection || !this.refundOperationModel || !this.outboxModel) {
      return this.refundLegacy(payment, dto);
    }
    const reservation = await this.reserveRefundOperation(payment, dto);
    if (!reservation.created) return this.findById(id);
    await this.processReservedRefund(payment, reservation.operation);
    return this.findById(id);
  }

  private async refundLegacy(
    payment: PaymentDocument,
    dto: RefundPaymentDto,
  ): Promise<PaymentDocument> {
    await this.assertRefundAllowed(payment);
    this.assertRefundableStatus(payment);
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
    payment.refunds.push({
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
    } as PaymentRefund);
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

  private async reserveRefundOperation(
    observedPayment: PaymentDocument,
    dto: RefundPaymentDto,
  ): Promise<{ operation: RefundOperationDocument; created: boolean }> {
    if (!this.connection || !this.refundOperationModel || !this.outboxModel) {
      throw new ServiceUnavailableException(
        'Ledger de devoluciones no disponible',
      );
    }
    let reserved:
      { operation: RefundOperationDocument; created: boolean } | undefined;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const session = await this.connection.startSession();
      try {
        await session.withTransaction(async () => {
          const payment = await this.paymentModel
            .findById(observedPayment._id)
            .session(session)
            .exec();
          if (!payment) throw new NotFoundException('Pago no encontrado');
          const previous = await this.refundOperationModel!.findOne({
            payment: payment._id,
            idempotencyKey: dto.idempotencyKey,
          })
            .session(session)
            .exec();
          if (previous) {
            if (
              dto.amount !== undefined &&
              previous.requestedAmountCents !== this.toCents(dto.amount)
            ) {
              throw new ConflictException(
                'La clave idempotente ya se usó con otro importe',
              );
            }
            reserved = { operation: previous, created: false };
            return;
          }
          if (
            payment.refunds?.some(
              (refund) => refund.idempotencyKey === dto.idempotencyKey,
            )
          ) {
            throw new ConflictException(
              'La clave corresponde a una devolución histórica; use una clave nueva solo si queda saldo',
            );
          }
          await this.assertRefundAllowed(payment, session);
          this.assertRefundableStatus(payment);
          await this.lockOrderForRefund(payment, session);
          const amountCents = this.paymentAmountCents(payment);
          const refundedCents =
            payment.refundedAmountCents ??
            this.toCents(payment.refundedAmount ?? 0);
          const reservedCents = payment.refundReservedAmountCents ?? 0;
          const refundableCents = amountCents - refundedCents - reservedCents;
          const requestedCents =
            dto.amount === undefined
              ? refundableCents
              : this.toCents(dto.amount);
          if (requestedCents <= 0 || requestedCents > refundableCents) {
            throw new BadRequestException(
              `El máximo reembolsable no reservado es ${centsToAmount(
                Math.max(0, refundableCents),
              ).toFixed(2)} ${payment.currency}`,
            );
          }

          const activeOperations = await this.refundOperationModel!.find({
            payment: payment._id,
            $or: [
              {
                status: {
                  $in: [
                    RefundOperationStatus.Pending,
                    RefundOperationStatus.Succeeded,
                  ],
                },
              },
              { succeededAmountCents: { $gt: 0 } },
            ],
          })
            .session(session)
            .lean()
            .exec();
          const allocations = this.allocateRefundAcrossReceipts(
            payment,
            requestedCents,
            activeOperations,
          );
          const [operation] = await this.refundOperationModel!.create(
            [
              {
                payment: payment._id,
                idempotencyKey: dto.idempotencyKey,
                requestedAmountCents: requestedCents,
                reservedAmountCents: requestedCents,
                succeededAmountCents: 0,
                status: RefundOperationStatus.Pending,
                allocations,
                reason: dto.reason,
              },
            ],
            { session },
          );
          payment.refundReservedAmountCents = reservedCents + requestedCents;
          payment.amountCents = amountCents;
          payment.refundedAmountCents = refundedCents;
          const previousStatus = payment.status;
          this.applyStatusTransition(
            payment,
            PaymentStatus.RefundPending,
            PaymentEventSource.Application,
            dto.reason || 'Saldo reservado para devolución Pix',
          );
          if (previousStatus !== payment.status) {
            payment.transitionSequence = (payment.transitionSequence ?? 0) + 1;
          }
          await payment.save({ session });
          if (previousStatus !== payment.status) {
            await this.createOutboxEvent(
              payment,
              previousStatus,
              PaymentEventSource.Application,
              session,
            );
          }
          reserved = { operation, created: true };
        });
        break;
      } catch (error) {
        if (attempt >= 4 || !this.isRetryableTransactionError(error))
          throw error;
      } finally {
        await session.endSession();
      }
    }
    if (!reserved) {
      throw new ServiceUnavailableException(
        'No se pudo reservar el saldo de devolución',
      );
    }
    await this.processOutboxForPayment(observedPayment._id.toString());
    return reserved;
  }

  private allocateRefundAcrossReceipts(
    payment: PaymentDocument,
    requestedCents: number,
    operations: Array<{
      allocations?: Array<{
        endToEndId: string;
        amountCents: number;
        status?: RefundOperationStatus;
        providerRefundId?: string;
      }>;
    }>,
  ): RefundAllocation[] {
    const receipts = payment.receipts?.length
      ? payment.receipts.map((receipt) => ({
          endToEndId: receipt.endToEndId,
          amountCents: receipt.amountCents,
        }))
      : payment.endToEndId
        ? [
            {
              endToEndId: payment.endToEndId,
              amountCents: this.paymentAmountCents(payment),
            },
          ]
        : [];
    if (!receipts.length) {
      throw new ConflictException(
        'El pago no tiene recibos/endToEndId conciliados para devolver',
      );
    }
    const alreadyAllocated = new Map<string, number>();
    let trackedSucceededCents = 0;
    const trackedProviderRefundIds = new Set<string>();
    for (const operation of operations) {
      for (const allocation of operation.allocations ?? []) {
        if (
          allocation.status &&
          ![
            RefundOperationStatus.Pending,
            RefundOperationStatus.Succeeded,
          ].includes(allocation.status)
        ) {
          continue;
        }
        alreadyAllocated.set(
          allocation.endToEndId,
          (alreadyAllocated.get(allocation.endToEndId) ?? 0) +
            allocation.amountCents,
        );
        if (allocation.status === RefundOperationStatus.Succeeded) {
          trackedSucceededCents += allocation.amountCents;
        }
        if (allocation.providerRefundId) {
          trackedProviderRefundIds.add(
            `${allocation.endToEndId}:${allocation.providerRefundId}`,
          );
        }
      }
    }
    const externalByEndToEndId = new Map<string, number>();
    for (const refund of payment.providerRefunds ?? []) {
      if (
        refund.status !== PaymentStatus.Refunded ||
        trackedProviderRefundIds.has(
          `${refund.endToEndId}:${refund.providerRefundId}`,
        )
      ) {
        continue;
      }
      externalByEndToEndId.set(
        refund.endToEndId,
        (externalByEndToEndId.get(refund.endToEndId) ?? 0) + refund.amountCents,
      );
    }
    const externalSnapshotCents = [...externalByEndToEndId.values()].reduce(
      (sum, value) => sum + value,
      0,
    );
    let untrackedRefunded = Math.max(
      0,
      (payment.refundedAmountCents ??
        this.toCents(payment.refundedAmount ?? 0)) -
        trackedSucceededCents -
        externalSnapshotCents,
    );
    let remaining = requestedCents;
    const allocations: RefundAllocation[] = [];
    for (const receipt of receipts) {
      const knownExternal = externalByEndToEndId.get(receipt.endToEndId) ?? 0;
      const fallbackExternal = Math.min(
        Math.max(0, receipt.amountCents - knownExternal),
        untrackedRefunded,
      );
      const externalConsumed = knownExternal + fallbackExternal;
      untrackedRefunded -= fallbackExternal;
      const available = Math.max(
        0,
        receipt.amountCents -
          externalConsumed -
          (alreadyAllocated.get(receipt.endToEndId) ?? 0),
      );
      const allocated = Math.min(available, remaining);
      if (allocated > 0) {
        allocations.push({
          endToEndId: receipt.endToEndId,
          amountCents: allocated,
          status: RefundOperationStatus.Pending,
        });
        remaining -= allocated;
      }
      if (remaining === 0) break;
    }
    if (remaining !== 0) {
      throw new ConflictException(
        'El saldo contable no coincide con los recibos Pix; requiere conciliación',
      );
    }
    return allocations;
  }

  private async lockOrderForRefund(
    payment: PaymentDocument,
    session: ClientSession,
  ): Promise<void> {
    if (!this.orderModel) return;
    const order = await this.orderModel
      .findById(payment.order)
      .select('+prizeLifecycleVersion')
      .session(session)
      .exec();
    if (!order) throw new NotFoundException('Pedido del pago no encontrado');
    if (![OrderStatus.Paid, OrderStatus.InReview].includes(order.status)) {
      throw new ConflictException(
        `El pedido ${order.status} no admite una devolución voluntaria`,
      );
    }
    if (order.status === OrderStatus.InReview && this.quotaModel) {
      const paidQuotas = await this.quotaModel
        .countDocuments({
          order: order._id,
          status: { $in: [QuotaStatus.Paid, QuotaStatus.Awarded] },
        })
        .session(session)
        .exec();
      if (paidQuotas !== order.allocatedQuantity) {
        throw new ConflictException(
          'La liquidación de cuotas del pago aún está pendiente; reintente el outbox antes de devolver',
        );
      }
    }
    order.status = OrderStatus.InReview;
    order.prizeLifecycleVersion = (order.prizeLifecycleVersion ?? 0) + 1;
    order.statusHistory.push({
      status: OrderStatus.InReview,
      at: new Date(),
      reason: 'Saldo bloqueado para devolución Pix',
    });
    await order.save({ session });
  }

  private async processReservedRefund(
    payment: PaymentDocument,
    operation: RefundOperationDocument,
  ): Promise<void> {
    const provider = this.providerFactory.get(payment.provider);
    const results: Array<{
      index: number;
      status: RefundOperationStatus;
      providerRefundId?: string;
      providerPayload?: Record<string, unknown>;
      error?: string;
      inconsistent?: boolean;
    }> = [];
    for (let index = 0; index < operation.allocations.length; index += 1) {
      const allocation = operation.allocations[index];
      try {
        const result = await provider.refundPayment({
          txid: payment.txid,
          externalId: payment.externalId,
          endToEndId: allocation.endToEndId,
          amount: centsToAmount(allocation.amountCents),
          idempotencyKey: this.refundAllocationKey(
            operation.idempotencyKey,
            index,
          ),
        });
        const returnedCents = this.toCents(result.amount);
        const inconsistent = returnedCents !== allocation.amountCents;
        results.push({
          index,
          status:
            !inconsistent && result.status === PaymentStatus.Refunded
              ? RefundOperationStatus.Succeeded
              : result.status === PaymentStatus.Paid
                ? RefundOperationStatus.Failed
                : RefundOperationStatus.Pending,
          providerRefundId: result.providerRefundId,
          providerPayload: result.raw
            ? this.boundedProviderPayload(result.raw)
            : undefined,
          error: inconsistent
            ? `El PSP informó ${returnedCents} centavos para una asignación de ${allocation.amountCents}`
            : undefined,
          inconsistent,
        });
      } catch (error) {
        results.push({
          index,
          // Un timeout/error de red es ambiguo: Efí podría haber aceptado el
          // PUT idempotente. Se conserva la reserva hasta conciliarlo.
          status: RefundOperationStatus.Pending,
          error:
            `Resultado PSP desconocido: ${this.providerErrorMessage(error)}`.slice(
              0,
              1000,
            ),
        });
      }
    }
    await this.finalizeRefundOperation(payment._id, operation._id, results);
  }

  private refundAllocationKey(idempotencyKey: string, index: number): string {
    return createHash('sha256')
      .update(`${idempotencyKey}:allocation:${index}`)
      .digest('hex');
  }

  private async finalizeRefundOperation(
    paymentId: Types.ObjectId,
    operationId: Types.ObjectId,
    results: Array<{
      index: number;
      status: RefundOperationStatus;
      providerRefundId?: string;
      providerPayload?: Record<string, unknown>;
      error?: string;
      inconsistent?: boolean;
    }>,
  ): Promise<void> {
    if (!this.connection || !this.refundOperationModel || !this.outboxModel) {
      throw new ServiceUnavailableException(
        'Ledger de devoluciones no disponible',
      );
    }
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const session = await this.connection.startSession();
      try {
        await session.withTransaction(async () => {
          const [payment, operation] = await Promise.all([
            this.paymentModel.findById(paymentId).session(session).exec(),
            this.refundOperationModel!.findById(operationId)
              .session(session)
              .exec(),
          ]);
          if (!payment || !operation) {
            throw new NotFoundException(
              'Pago u operación de devolución no encontrada',
            );
          }
          if (operation.status === RefundOperationStatus.Succeeded) return;

          let newlySucceededCents = 0;
          let inconsistent = false;
          for (const result of results) {
            const allocation = operation.allocations[result.index];
            if (
              !allocation ||
              allocation.status !== RefundOperationStatus.Pending
            ) {
              continue;
            }
            allocation.status = result.status;
            allocation.providerRefundId = result.providerRefundId;
            allocation.providerPayload = result.providerPayload;
            allocation.error = result.error;
            if (result.status === RefundOperationStatus.Succeeded) {
              newlySucceededCents += allocation.amountCents;
            }
            inconsistent ||= Boolean(result.inconsistent);
          }
          const pendingCents = operation.allocations
            .filter(
              (allocation) =>
                allocation.status === RefundOperationStatus.Pending,
            )
            .reduce((sum, allocation) => sum + allocation.amountCents, 0);
          const previousReserved = operation.reservedAmountCents;
          operation.reservedAmountCents = pendingCents;
          operation.succeededAmountCents =
            (operation.succeededAmountCents ?? 0) + newlySucceededCents;
          if (pendingCents > 0) {
            operation.status = RefundOperationStatus.Pending;
          } else if (
            operation.succeededAmountCents === operation.requestedAmountCents
          ) {
            operation.status = RefundOperationStatus.Succeeded;
            operation.completedAt = new Date();
          } else {
            operation.status = RefundOperationStatus.Failed;
            operation.completedAt = new Date();
          }
          operation.lastError = operation.allocations
            .map((allocation) => allocation.error)
            .filter(Boolean)
            .join(' | ')
            .slice(0, 2000);

          payment.amountCents = this.paymentAmountCents(payment);
          payment.refundReservedAmountCents = Math.max(
            0,
            (payment.refundReservedAmountCents ?? 0) -
              previousReserved +
              pendingCents,
          );
          payment.refundedAmountCents = Math.min(
            payment.amountCents,
            (payment.refundedAmountCents ??
              this.toCents(payment.refundedAmount ?? 0)) + newlySucceededCents,
          );
          payment.refundedAmount = centsToAmount(payment.refundedAmountCents);

          const providerIds = operation.allocations
            .map((allocation) => allocation.providerRefundId)
            .filter((value): value is string => Boolean(value));
          const embeddedStatus =
            operation.status === RefundOperationStatus.Succeeded
              ? PaymentStatus.Refunded
              : operation.status === RefundOperationStatus.Pending
                ? PaymentStatus.RefundPending
                : payment.refundedAmountCents > 0
                  ? PaymentStatus.PartiallyRefunded
                  : PaymentStatus.Paid;
          const refundEntry = payment.refunds.find(
            (refund) => refund.idempotencyKey === operation.idempotencyKey,
          );
          const embedded: PaymentRefund = {
            idempotencyKey: operation.idempotencyKey,
            providerRefundId: providerIds.join(',') || undefined,
            amount: centsToAmount(operation.requestedAmountCents),
            status: embeddedStatus,
            providerPayload: {
              operationId: operation._id.toString(),
              allocations: operation.allocations.map((allocation) => ({
                endToEndId: allocation.endToEndId,
                amountCents: allocation.amountCents,
                providerRefundId: allocation.providerRefundId,
                status: allocation.status,
              })),
            },
            requestedAt:
              (operation as RefundOperationDocument & { createdAt?: Date })
                .createdAt ?? new Date(),
            completedAt:
              operation.status === RefundOperationStatus.Succeeded
                ? operation.completedAt
                : undefined,
          };
          if (refundEntry) Object.assign(refundEntry, embedded);
          else payment.refunds.push(embedded);

          let nextStatus: PaymentStatus;
          if (inconsistent) nextStatus = PaymentStatus.UnderReview;
          else if (pendingCents > 0) nextStatus = PaymentStatus.RefundPending;
          else if (payment.refundedAmountCents >= payment.amountCents)
            nextStatus = PaymentStatus.Refunded;
          else if (payment.refundedAmountCents > 0)
            nextStatus = PaymentStatus.PartiallyRefunded;
          else nextStatus = PaymentStatus.Paid;

          const previousStatus = payment.status;
          this.applyStatusTransition(
            payment,
            nextStatus,
            PaymentEventSource.Provider,
            operation.lastError || operation.reason,
            {
              refundOperationId: operation._id.toString(),
              requestedAmountCents: operation.requestedAmountCents,
              succeededAmountCents: operation.succeededAmountCents,
              reservedAmountCents: operation.reservedAmountCents,
            },
          );
          if (previousStatus !== payment.status) {
            payment.transitionSequence = (payment.transitionSequence ?? 0) + 1;
          }
          await Promise.all([
            operation.save({ session }),
            payment.save({ session }),
          ]);
          if (previousStatus !== payment.status) {
            await this.createOutboxEvent(
              payment,
              previousStatus,
              PaymentEventSource.Provider,
              session,
            );
          }
        });
        await this.processOutboxForPayment(paymentId.toString());
        return;
      } catch (error) {
        if (attempt >= 4 || !this.isRetryableTransactionError(error))
          throw error;
      } finally {
        await session.endSession();
      }
    }
  }

  private assertRefundableStatus(payment: PaymentDocument): void {
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
  }

  async expireDuePayments(): Promise<number> {
    const due = await this.paymentModel
      .find({
        status: { $in: EXPIRABLE_PAYMENT_STATUSES },
        expiresAt: { $lte: new Date() },
      })
      .exec();
    let expired = 0;
    for (const payment of due) {
      try {
        const reconciled = await this.reconcile(payment._id.toString());
        if (reconciled.status === PaymentStatus.Expired) expired += 1;
      } catch (error) {
        this.logger.warn(
          `No se pudo confirmar el vencimiento Pix ${payment._id.toString()} (${this.operationalErrorLabel(error)})`,
        );
        try {
          await this.transition(
            payment,
            PaymentStatus.UnderReview,
            PaymentEventSource.Reconciliation,
            'No se pudo confirmar con el PSP que el Pix seguía impago al vencer; la reserva queda bloqueada',
            undefined,
            { providerError: this.operationalErrorLabel(error) },
            EXPIRABLE_PAYMENT_STATUSES,
          );
        } catch (transitionError) {
          if (!(transitionError instanceof ConflictException)) {
            throw transitionError;
          }
        }
      }
    }
    return expired;
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
        let fresh = await this.findById(payment._id.toString());
        const financialPatch: PaymentMutationPatch = {
          providerPayload: persistedPayload,
          legacyEndToEndId: event.endToEndId,
          paidAt: event.paidAt,
          receipts: event.receipts,
          refunds: event.refunds,
          receiptIntegrityError: event.receiptIntegrityError,
          enforceExactReceiptAmount:
            providerName === PaymentProviderName.Efi &&
            (event.status === PaymentStatus.Paid ||
              event.status === PaymentStatus.RefundPending ||
              event.status === PaymentStatus.PartiallyRefunded ||
              event.status === PaymentStatus.Refunded),
          authoritativeRefundedAmountCents: event.refundedAmountCents,
        };
        const webhookStatus = event.status;
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
            financialPatch,
          );
          fresh = await this.findById(payment._id.toString());
        }
        if (
          ![
            PaymentStatus.RefundPending,
            PaymentStatus.PartiallyRefunded,
            PaymentStatus.Refunded,
          ].includes(webhookStatus) ||
          [
            PaymentStatus.Paid,
            PaymentStatus.RefundPending,
            PaymentStatus.PartiallyRefunded,
            PaymentStatus.Refunded,
          ].includes(fresh.status)
        ) {
          await this.transition(
            fresh,
            webhookStatus,
            PaymentEventSource.Webhook,
            undefined,
            persistedPayload,
            financialPatch,
          );
        }
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
      receivedAmount: centsToAmount(payment.receivedAmountCents ?? 0),
      createdAt: payment.createdAt,
      updatedAt: payment.updatedAt,
    };
  }

  toAdminView(payment: PaymentDocument): Record<string, unknown> {
    const value = payment.toObject() as unknown as Record<string, unknown>;
    delete value.publicSecretHash;
    // Las respuestas crudas de Efí y los webhooks pueden contener CPF, nombre,
    // clave Pix u otros datos del pagador. Se conservan para conciliación
    // interna, pero no forman parte del contrato HTTP de operación.
    delete value.providerPayload;
    delete value.webhookPayloads;
    if (Array.isArray(value.statusHistory)) {
      value.statusHistory = value.statusHistory.map((entry) => {
        const safe = { ...(entry as Record<string, unknown>) };
        delete safe.metadata;
        return safe;
      });
    }
    if (Array.isArray(value.refunds)) {
      value.refunds = value.refunds.map((entry) => {
        const safe = { ...(entry as Record<string, unknown>) };
        delete safe.providerPayload;
        return safe;
      });
    }
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
          undefined,
          { providerError: payment.providerError },
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
    const providerPayload = result.raw
      ? this.boundedProviderPayload(result.raw)
      : undefined;
    let providerStatus = result.status;
    if ((result.receipts?.length ?? 0) > 0) {
      providerStatus = PaymentStatus.Paid;
    }
    const pendingRefund = result.refunds?.some(
      (refund) => refund.status === PaymentStatus.RefundPending,
    );
    if (pendingRefund) providerStatus = PaymentStatus.RefundPending;
    else if ((result.refundedAmountCents ?? 0) > 0) {
      providerStatus =
        (result.refundedAmountCents ?? 0) >=
        (payment.amountCents ?? this.toCents(payment.amount))
          ? PaymentStatus.Refunded
          : PaymentStatus.PartiallyRefunded;
    }

    if (
      [PaymentStatus.Paid, PaymentStatus.PartiallyRefunded].includes(
        payment.status,
      ) &&
      [PaymentStatus.Pending, PaymentStatus.Active].includes(providerStatus)
    ) {
      await this.transition(
        payment,
        payment.status,
        source,
        reason,
        providerPayload,
        {
          externalId: result.externalId,
          txid: result.txid,
          qrCode: result.qrCode,
          qrCodeImage: result.qrCodeImage,
          pixCopyPaste: result.pixCopyPaste,
          checkoutUrl: result.checkoutUrl,
          legacyEndToEndId: result.endToEndId,
          paidAt: result.paidAt,
          providerPayload,
          providerError: undefined,
          receipts: result.receipts,
          refunds: result.refunds,
          receiptIntegrityError: result.receiptIntegrityError,
          enforceExactReceiptAmount:
            payment.provider === PaymentProviderName.Efi &&
            (result.status === PaymentStatus.Paid ||
              Boolean(result.receipts?.length)),
          authoritativeRefundedAmountCents: result.refundedAmountCents,
        },
      );
      return;
    }
    await this.transition(
      payment,
      providerStatus,
      source,
      reason,
      providerPayload,
      {
        externalId: result.externalId,
        txid: result.txid,
        qrCode: result.qrCode,
        qrCodeImage: result.qrCodeImage,
        pixCopyPaste: result.pixCopyPaste,
        checkoutUrl: result.checkoutUrl,
        legacyEndToEndId: result.endToEndId,
        paidAt: result.paidAt,
        providerPayload,
        providerError: undefined,
        receipts: result.receipts,
        refunds: result.refunds,
        receiptIntegrityError: result.receiptIntegrityError,
        enforceExactReceiptAmount:
          payment.provider === PaymentProviderName.Efi &&
          (result.status === PaymentStatus.Paid ||
            Boolean(result.receipts?.length)),
        authoritativeRefundedAmountCents: result.refundedAmountCents,
      },
    );
  }

  private async transition(
    payment: PaymentDocument,
    status: PaymentStatus,
    source: PaymentEventSource,
    reason?: string,
    metadata?: Record<string, unknown>,
    patch: PaymentMutationPatch = {},
    expectedCurrentStatuses?: readonly PaymentStatus[],
  ): Promise<void> {
    if (!this.connection || !this.outboxModel) {
      if (
        expectedCurrentStatuses &&
        !expectedCurrentStatuses.includes(payment.status)
      ) {
        return;
      }
      const resolved = await this.prepareTransition(
        payment,
        status,
        reason,
        patch,
      );
      const previousStatus = payment.status;
      this.applyStatusTransition(
        payment,
        resolved.status,
        source,
        resolved.reason,
        metadata,
      );
      await payment.save();
      if (previousStatus !== payment.status) {
        await this.notifyLifecycleDirect(payment, previousStatus, source);
      }
      return;
    }

    let persisted: PaymentDocument | undefined;
    let changed = false;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const session = await this.connection.startSession();
      try {
        await session.withTransaction(async () => {
          const fresh = await this.paymentModel
            .findById(payment._id)
            .session(session)
            .exec();
          if (!fresh) throw new NotFoundException('Pago no encontrado');
          if (
            expectedCurrentStatuses &&
            !expectedCurrentStatuses.includes(fresh.status)
          ) {
            persisted = fresh;
            changed = false;
            return;
          }
          const previousStatus = fresh.status;
          const resolved = await this.prepareTransition(
            fresh,
            status,
            reason,
            patch,
            session,
          );
          this.applyStatusTransition(
            fresh,
            resolved.status,
            source,
            resolved.reason,
            metadata,
          );
          changed = previousStatus !== fresh.status;
          if (changed)
            fresh.transitionSequence = (fresh.transitionSequence ?? 0) + 1;
          await fresh.save({ session });
          if (changed) {
            await this.createOutboxEvent(
              fresh,
              previousStatus,
              source,
              session,
            );
          }
          persisted = fresh;
        });
        break;
      } catch (error) {
        if (attempt >= 4 || !this.isRetryableTransactionError(error))
          throw error;
      } finally {
        await session.endSession();
      }
    }
    if (!persisted) {
      throw new ServiceUnavailableException(
        'No se pudo serializar la transición financiera',
      );
    }
    this.copyPaymentState(payment, persisted);
    if (changed) await this.processOutboxForPayment(payment._id.toString());
  }

  private async prepareTransition(
    payment: PaymentDocument,
    requestedStatus: PaymentStatus,
    reason: string | undefined,
    patch: PaymentMutationPatch,
    session?: ClientSession,
  ): Promise<{ status: PaymentStatus; reason?: string }> {
    this.applyPaymentPatch(payment, patch);
    let status = requestedStatus;
    let resolvedReason = reason;
    const enforceExactReceiptAmount =
      patch.enforceExactReceiptAmount ||
      (payment.provider === PaymentProviderName.Efi &&
        requestedStatus === PaymentStatus.Paid);
    if (patch.receipts || enforceExactReceiptAmount) {
      const merge = mergePixReceipts(
        (payment.receipts ?? []).map((receipt) => ({
          endToEndId: receipt.endToEndId,
          amountCents: receipt.amountCents,
          paidAt: receipt.paidAt,
        })),
        patch.receipts ?? [],
      );
      payment.receipts = merge.receipts as PaymentReceipt[];
      payment.endToEndIds = merge.receipts.map((receipt) => receipt.endToEndId);
      payment.endToEndId = payment.endToEndIds[0] ?? payment.endToEndId;
      payment.receivedAmountCents = merge.receipts.reduce(
        (sum, receipt) => sum + receipt.amountCents,
        0,
      );
      if (merge.receipts.length) {
        payment.paidAt = new Date(
          Math.max(
            ...merge.receipts.map((receipt) => receipt.paidAt.getTime()),
          ),
        );
      }
      const integrityError = [patch.receiptIntegrityError, merge.integrityError]
        .filter(Boolean)
        .join(' | ');
      if (
        enforceExactReceiptAmount &&
        (integrityError ||
          payment.receivedAmountCents !== this.paymentAmountCents(payment))
      ) {
        status = PaymentStatus.UnderReview;
        resolvedReason = integrityError
          ? `Pix inconsistente: ${integrityError}`
          : `Importe Pix recibido ${centsToAmount(
              payment.receivedAmountCents,
            ).toFixed(2)}; esperado ${payment.amount.toFixed(2)}`;
      }
    }
    let authoritativeRefundedAmountCents =
      patch.authoritativeRefundedAmountCents;
    if (patch.refunds?.length) {
      const mergedRefunds = this.mergeProviderRefunds(
        payment.providerRefunds ?? [],
        patch.refunds,
      );
      payment.providerRefunds = mergedRefunds.refunds;
      if (mergedRefunds.integrityError) {
        status = PaymentStatus.UnderReview;
        resolvedReason = `Devolución Pix inconsistente: ${mergedRefunds.integrityError}`;
      }
      authoritativeRefundedAmountCents = mergedRefunds.refunds
        .filter((refund) => refund.status === PaymentStatus.Refunded)
        .reduce((sum, refund) => sum + refund.amountCents, 0);
    }
    if (authoritativeRefundedAmountCents !== undefined) {
      if (patch.refunds?.length && session) {
        await this.synchronizeRefundLedger(payment, patch.refunds, session);
      }
      const authoritative = Math.min(
        this.paymentAmountCents(payment),
        Math.max(0, authoritativeRefundedAmountCents),
      );
      payment.refundedAmountCents = Math.max(
        payment.refundedAmountCents ??
          this.toCents(payment.refundedAmount ?? 0),
        authoritative,
      );
      payment.refundedAmount = centsToAmount(payment.refundedAmountCents);
      if (
        status === PaymentStatus.PartiallyRefunded &&
        payment.refundedAmountCents >= this.paymentAmountCents(payment)
      ) {
        status = PaymentStatus.Refunded;
      }
    }

    if (
      status === PaymentStatus.Paid &&
      payment.status !== PaymentStatus.Paid
    ) {
      const orderReserved = await this.reserveOrderForSettlement(
        payment,
        session,
      );
      if (!orderReserved) {
        status = PaymentStatus.UnderReview;
        resolvedReason =
          'Pix recibido cuando el pedido ya no conservaba su reserva; requiere revisión y eventual devolución';
      }
    }
    return { status, reason: resolvedReason };
  }

  private async synchronizeRefundLedger(
    payment: PaymentDocument,
    refunds: PixRefundSnapshot[],
    session: ClientSession,
  ): Promise<void> {
    if (!this.refundOperationModel) return;
    const operations = await this.refundOperationModel
      .find({ payment: payment._id, status: RefundOperationStatus.Pending })
      .session(session)
      .exec();
    let releasedCents = 0;
    for (const operation of operations) {
      let changed = false;
      for (const allocation of operation.allocations) {
        if (
          allocation.status !== RefundOperationStatus.Pending ||
          !allocation.providerRefundId
        ) {
          continue;
        }
        const snapshot = refunds.find(
          (refund) =>
            refund.providerRefundId === allocation.providerRefundId &&
            refund.endToEndId === allocation.endToEndId,
        );
        if (!snapshot || snapshot.status === PaymentStatus.RefundPending)
          continue;
        if (snapshot.amountCents !== allocation.amountCents) {
          allocation.error =
            'El importe confirmado por Efí no coincide con la asignación reservada';
          continue;
        }
        allocation.status =
          snapshot.status === PaymentStatus.Refunded
            ? RefundOperationStatus.Succeeded
            : RefundOperationStatus.Failed;
        if (allocation.status === RefundOperationStatus.Succeeded) {
          operation.succeededAmountCents += allocation.amountCents;
        }
        releasedCents += allocation.amountCents;
        changed = true;
      }
      if (!changed) continue;
      operation.reservedAmountCents = operation.allocations
        .filter(
          (allocation) => allocation.status === RefundOperationStatus.Pending,
        )
        .reduce((sum, allocation) => sum + allocation.amountCents, 0);
      if (operation.reservedAmountCents > 0) {
        operation.status = RefundOperationStatus.Pending;
      } else if (
        operation.succeededAmountCents === operation.requestedAmountCents
      ) {
        operation.status = RefundOperationStatus.Succeeded;
        operation.completedAt = new Date();
      } else {
        operation.status = RefundOperationStatus.Failed;
        operation.completedAt = new Date();
      }
      const embedded = payment.refunds.find(
        (refund) => refund.idempotencyKey === operation.idempotencyKey,
      );
      if (embedded) {
        embedded.status =
          operation.status === RefundOperationStatus.Succeeded
            ? PaymentStatus.Refunded
            : operation.status === RefundOperationStatus.Pending
              ? PaymentStatus.RefundPending
              : operation.succeededAmountCents > 0
                ? PaymentStatus.PartiallyRefunded
                : PaymentStatus.Paid;
        embedded.completedAt =
          operation.status === RefundOperationStatus.Pending
            ? undefined
            : operation.completedAt;
      }
      await operation.save({ session });
    }
    payment.refundReservedAmountCents = Math.max(
      0,
      (payment.refundReservedAmountCents ?? 0) - releasedCents,
    );
  }

  private applyPaymentPatch(
    payment: PaymentDocument,
    patch: PaymentMutationPatch,
  ): void {
    if (patch.externalId) payment.externalId = patch.externalId;
    if (patch.txid) payment.txid = patch.txid;
    if (patch.qrCode) payment.qrCode = patch.qrCode;
    if (patch.qrCodeImage) payment.qrCodeImage = patch.qrCodeImage;
    if (patch.pixCopyPaste) payment.pixCopyPaste = patch.pixCopyPaste;
    if (patch.checkoutUrl) payment.checkoutUrl = patch.checkoutUrl;
    if (patch.legacyEndToEndId) {
      payment.endToEndId = patch.legacyEndToEndId;
      if (!payment.endToEndIds?.includes(patch.legacyEndToEndId)) {
        payment.endToEndIds = [
          ...(payment.endToEndIds ?? []),
          patch.legacyEndToEndId,
        ];
      }
    }
    if (patch.paidAt && Number.isFinite(patch.paidAt.getTime())) {
      payment.paidAt = patch.paidAt;
    }
    if (patch.providerPayload) payment.providerPayload = patch.providerPayload;
    if (Object.prototype.hasOwnProperty.call(patch, 'providerError')) {
      payment.providerError = patch.providerError;
    }
    payment.amountCents = this.paymentAmountCents(payment);
    payment.receivedAmountCents = payment.receivedAmountCents ?? 0;
    payment.refundedAmountCents =
      payment.refundedAmountCents ?? this.toCents(payment.refundedAmount ?? 0);
    payment.refundReservedAmountCents = payment.refundReservedAmountCents ?? 0;
    payment.receipts = payment.receipts ?? [];
    payment.providerRefunds = payment.providerRefunds ?? [];
    payment.endToEndIds = payment.endToEndIds ?? [];
    payment.transitionSequence = payment.transitionSequence ?? 0;
  }

  private mergeProviderRefunds(
    stored: PaymentProviderRefund[],
    incoming: PixRefundSnapshot[],
  ): { refunds: PaymentProviderRefund[]; integrityError?: string } {
    const refunds = new Map<string, PaymentProviderRefund>();
    const errors = new Set<string>();
    for (const refund of [...stored, ...incoming]) {
      const key = `${refund.endToEndId}:${refund.providerRefundId}`;
      const normalized: PaymentProviderRefund = {
        providerRefundId: refund.providerRefundId,
        endToEndId: refund.endToEndId,
        amountCents: refund.amountCents,
        status: refund.status,
      };
      const previous = refunds.get(key);
      if (previous && previous.amountCents !== normalized.amountCents) {
        errors.add(
          `la devolución ${refund.providerRefundId} cambió de importe`,
        );
        continue;
      }
      if (
        previous?.status === PaymentStatus.Refunded ||
        (previous?.status === PaymentStatus.Paid &&
          normalized.status === PaymentStatus.RefundPending)
      ) {
        continue;
      }
      refunds.set(key, normalized);
    }
    return {
      refunds: [...refunds.values()],
      integrityError: errors.size ? [...errors].join(' | ') : undefined,
    };
  }

  private applyStatusTransition(
    payment: PaymentDocument,
    status: PaymentStatus,
    source: PaymentEventSource,
    reason?: string,
    metadata?: Record<string, unknown>,
  ): void {
    const previousStatus = payment.status;
    if (previousStatus === status) return;
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
  }

  private async reserveOrderForSettlement(
    payment: PaymentDocument,
    session?: ClientSession,
  ): Promise<boolean> {
    if (!this.orderModel) return true;
    if (
      [PaymentStatus.Expired, PaymentStatus.Cancelled].includes(payment.status)
    ) {
      return false;
    }
    const query = this.orderModel.findById(payment.order);
    if (session) query.session(session);
    const order = await query.exec();
    if (!order) return false;
    if (order.payment && order.payment.toString() !== payment._id.toString()) {
      return false;
    }
    if (order.status === OrderStatus.Paid) return true;
    if (
      ![
        OrderStatus.Reserved,
        OrderStatus.PendingPayment,
        OrderStatus.InReview,
      ].includes(order.status)
    ) {
      return false;
    }
    const paidAt = payment.paidAt ?? new Date();
    if (paidAt.getTime() > order.expiresAt.getTime()) return false;
    if (!this.quotaModel) return true;
    const quotaQuery = this.quotaModel.countDocuments({
      order: order._id,
      status: QuotaStatus.Reserved,
    });
    if (session) quotaQuery.session(session);
    const reservedQuotas = await quotaQuery.exec();
    if (reservedQuotas !== order.allocatedQuantity) {
      const paidQuotaQuery = this.quotaModel.countDocuments({
        order: order._id,
        status: { $in: [QuotaStatus.Paid, QuotaStatus.Awarded] },
      });
      if (session) paidQuotaQuery.session(session);
      const paidQuotas = await paidQuotaQuery.exec();
      if (paidQuotas !== order.allocatedQuantity) return false;
    }
    order.payment = payment._id;
    order.paidAt = order.paidAt ?? paidAt;
    if (order.status !== OrderStatus.InReview) {
      order.status = OrderStatus.InReview;
      order.statusHistory.push({
        status: OrderStatus.InReview,
        at: new Date(),
        reason: 'Importe Pix exacto; reserva bloqueada para liquidación',
      });
    }
    await order.save(session ? { session } : undefined);
    return true;
  }

  private async createOutboxEvent(
    payment: PaymentDocument,
    previousStatus: PaymentStatus,
    source: PaymentEventSource,
    session: ClientSession,
  ): Promise<void> {
    if (!this.outboxModel) return;
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
    await this.outboxModel.create(
      [
        {
          eventKey: `${payment._id.toString()}:${payment.transitionSequence}`,
          payment: payment._id,
          sequence: payment.transitionSequence,
          orderId: event.orderId,
          campaignId: event.campaignId,
          userId: event.userId,
          provider: event.provider,
          previousStatus: event.previousStatus,
          status: event.status,
          source: event.source,
          amountCents: this.paymentAmountCents(payment),
          currency: event.currency,
          txid: event.txid,
          endToEndId: event.endToEndId,
          outboxStatus: PaymentOutboxStatus.Pending,
          nextAttemptAt: new Date(),
        },
      ],
      { session },
    );
  }

  @Cron('*/10 * * * * *')
  async processLifecycleOutbox(): Promise<number> {
    if (!this.outboxModel || this.lifecycleHooks.size === 0) return 0;
    let processed = 0;
    for (let index = 0; index < 25; index += 1) {
      const event = await this.claimOutboxEvent();
      if (!event) break;
      await this.processClaimedOutboxEvent(event);
      processed += 1;
    }
    return processed;
  }

  private async processOutboxForPayment(paymentId: string): Promise<void> {
    if (!this.outboxModel || this.lifecycleHooks.size === 0) return;
    for (let index = 0; index < 10; index += 1) {
      const event = await this.claimOutboxEvent(new Types.ObjectId(paymentId));
      if (!event) return;
      await this.processClaimedOutboxEvent(event);
    }
  }

  private claimOutboxEvent(
    payment?: Types.ObjectId,
  ): Promise<PaymentOutboxDocument | null> {
    if (!this.outboxModel) return Promise.resolve(null);
    const now = new Date();
    const staleLock = new Date(
      now.getTime() - this.outboxLockTimeoutSeconds() * 1000,
    );
    return this.outboxModel
      .findOneAndUpdate(
        {
          ...(payment ? { payment } : {}),
          $or: [
            {
              outboxStatus: PaymentOutboxStatus.Pending,
              nextAttemptAt: { $lte: now },
            },
            {
              outboxStatus: PaymentOutboxStatus.Processing,
              lockedAt: { $lte: staleLock },
            },
          ],
        },
        {
          $set: {
            outboxStatus: PaymentOutboxStatus.Processing,
            lockedAt: now,
          },
        },
        { new: true, sort: { nextAttemptAt: 1, createdAt: 1 } },
      )
      .exec();
  }

  private async processClaimedOutboxEvent(
    outbox: PaymentOutboxDocument,
  ): Promise<void> {
    if (!this.outboxModel) return;
    const event = this.outboxToLifecycleEvent(outbox);
    try {
      for (const [hookId, hooks] of this.lifecycleHooks.entries()) {
        for (const [method, callback] of this.lifecycleSteps(hooks, event)) {
          const step = `${hookId}:${method}`;
          if (outbox.completedSteps.includes(step)) continue;
          await callback();
          await this.outboxModel.updateOne(
            { _id: outbox._id },
            { $addToSet: { completedSteps: step } },
          );
          outbox.completedSteps.push(step);
        }
      }
      const completedAt = new Date();
      await Promise.all([
        this.outboxModel.updateOne(
          { _id: outbox._id },
          {
            $set: {
              outboxStatus: PaymentOutboxStatus.Succeeded,
              completedAt,
            },
            $unset: { lockedAt: 1, lastError: 1 },
          },
        ),
        this.paymentModel.updateOne(
          { _id: outbox.payment },
          {
            $unset: { lifecycleHookError: 1 },
            $set: { lifecycleHookProcessedAt: completedAt },
          },
        ),
      ]);
    } catch (error) {
      const message = this.operationalErrorLabel(error);
      const attempts = (outbox.attempts ?? 0) + 1;
      const deadLetter = attempts >= this.outboxMaxAttempts();
      const nextAttemptAt = new Date(
        Date.now() + this.outboxBackoffSeconds(attempts) * 1000,
      );
      await Promise.all([
        this.outboxModel.updateOne(
          { _id: outbox._id },
          {
            $set: {
              outboxStatus: deadLetter
                ? PaymentOutboxStatus.DeadLetter
                : PaymentOutboxStatus.Pending,
              attempts,
              nextAttemptAt,
              lastError: message,
            },
            $unset: { lockedAt: 1 },
          },
        ),
        this.paymentModel.updateOne(
          { _id: outbox.payment },
          { $set: { lifecycleHookError: message } },
        ),
      ]);
      this.logger.error(
        `Outbox ${outbox.eventKey} falló (intento ${attempts}, ${message})`,
      );
    }
  }

  private lifecycleSteps(
    hooks: PaymentLifecycleHooks,
    event: PaymentLifecycleEvent,
  ): Array<[string, () => Promise<void>]> {
    const steps: Array<[string, () => Promise<void>]> = [];
    if (hooks.onPaymentStatusChanged) {
      steps.push([
        'onPaymentStatusChanged',
        async () => void (await hooks.onPaymentStatusChanged?.(event)),
      ]);
    }
    if (event.status === PaymentStatus.Paid && hooks.onPaymentPaid) {
      steps.push([
        'onPaymentPaid',
        async () => void (await hooks.onPaymentPaid?.(event)),
      ]);
    }
    if (
      [PaymentStatus.Cancelled, PaymentStatus.Expired].includes(event.status) &&
      hooks.onPaymentCancelled
    ) {
      steps.push([
        'onPaymentCancelled',
        async () => void (await hooks.onPaymentCancelled?.(event)),
      ]);
    }
    if (
      [PaymentStatus.PartiallyRefunded, PaymentStatus.Refunded].includes(
        event.status,
      ) &&
      hooks.onPaymentRefunded
    ) {
      steps.push([
        'onPaymentRefunded',
        async () => void (await hooks.onPaymentRefunded?.(event)),
      ]);
    }
    return steps;
  }

  private outboxToLifecycleEvent(
    outbox: PaymentOutboxDocument,
  ): PaymentLifecycleEvent {
    return {
      paymentId: outbox.payment.toString(),
      orderId: outbox.orderId,
      campaignId: outbox.campaignId,
      userId: outbox.userId,
      provider: outbox.provider,
      previousStatus: outbox.previousStatus,
      status: outbox.status,
      source: outbox.source,
      amount: centsToAmount(outbox.amountCents),
      currency: outbox.currency,
      txid: outbox.txid,
      endToEndId: outbox.endToEndId,
    };
  }

  private async notifyLifecycleDirect(
    payment: PaymentDocument,
    previousStatus: PaymentStatus,
    source: PaymentEventSource,
  ): Promise<void> {
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
    for (const hooks of this.lifecycleHooks.values()) {
      for (const [, callback] of this.lifecycleSteps(hooks, event)) {
        try {
          await callback();
        } catch (error) {
          errors.push(this.operationalErrorLabel(error));
        }
      }
    }
    if (errors.length) {
      throw new ServiceUnavailableException(errors.join(' | ').slice(0, 2000));
    }
  }

  private outboxMaxAttempts(): number {
    return Math.min(
      50,
      Math.max(
        1,
        Number(this.config.get('PAYMENTS_OUTBOX_MAX_ATTEMPTS') ?? 12),
      ),
    );
  }

  private outboxLockTimeoutSeconds(): number {
    return Math.min(
      3600,
      Math.max(
        30,
        Number(this.config.get('PAYMENTS_OUTBOX_LOCK_SECONDS') ?? 300),
      ),
    );
  }

  private outboxBackoffSeconds(attempt: number): number {
    const base = Math.min(
      300,
      Math.max(
        1,
        Number(this.config.get('PAYMENTS_OUTBOX_BACKOFF_SECONDS') ?? 5),
      ),
    );
    return Math.min(3600, base * 2 ** Math.min(10, Math.max(0, attempt - 1)));
  }

  private extractWebhookEvents(
    providerName: PaymentProviderName,
    payload: Record<string, unknown>,
  ): Array<{
    txid?: string;
    eventId?: string;
    endToEndId?: string;
    paidAt?: Date;
    status: PaymentStatus;
    receipts?: PixReceiptSnapshot[];
    refunds?: PixRefundSnapshot[];
    refundedAmountCents?: number;
    receiptIntegrityError?: string;
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
    const groups = new Map<string, Record<string, unknown>[]>();
    const invalid: Record<string, unknown>[] = [];
    for (const rawItem of pix) {
      if (!rawItem || typeof rawItem !== 'object' || Array.isArray(rawItem)) {
        invalid.push({ invalidPixEntry: String(rawItem) });
        continue;
      }
      const item = rawItem as Record<string, unknown>;
      const txid = typeof item.txid === 'string' ? item.txid.trim() : '';
      if (!txid) {
        invalid.push(item);
        continue;
      }
      groups.set(txid, [...(groups.get(txid) ?? []), item]);
    }
    const events = [...groups.entries()].map(([txid, items]) => {
      const summary = summarizeEfiPixEntries(items);
      const pendingRefund = summary.refunds.some(
        (refund) => refund.status === PaymentStatus.RefundPending,
      );
      let status = PaymentStatus.Paid;
      if (pendingRefund) status = PaymentStatus.RefundPending;
      else if (summary.refundedAmountCents > 0)
        status = PaymentStatus.PartiallyRefunded;
      const paidAt = summary.receipts.length
        ? new Date(
            Math.max(
              ...summary.receipts.map((receipt) => receipt.paidAt.getTime()),
            ),
          )
        : undefined;
      return {
        txid,
        eventId: createHash('sha256')
          .update(stableStringify(items))
          .digest('hex'),
        endToEndId: summary.receipts[0]?.endToEndId,
        paidAt,
        status,
        receipts: summary.receipts,
        refunds: summary.refunds,
        refundedAmountCents: summary.refundedAmountCents,
        receiptIntegrityError: summary.integrityError,
        raw: { txid, pix: items },
      };
    });
    return [
      ...events,
      ...invalid.map((raw) => ({
        status: PaymentStatus.UnderReview,
        receiptIntegrityError: 'Evento Pix sin txid o con formato inválido',
        raw,
      })),
    ];
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

  private toCents(amount: number): number {
    if (!Number.isFinite(amount) || amount < 0) {
      throw new BadRequestException('Importe financiero inválido');
    }
    const cents = Math.round(amount * 100);
    if (Math.abs(amount * 100 - cents) > 1e-7) {
      throw new BadRequestException(
        'El importe admite como máximo 2 decimales',
      );
    }
    return cents;
  }

  private paymentAmountCents(payment: PaymentDocument): number {
    const cents = payment.amountCents ?? this.toCents(payment.amount);
    if (!Number.isSafeInteger(cents) || cents <= 0) {
      throw new BadRequestException('Importe del pago inválido');
    }
    return cents;
  }

  private copyPaymentState(
    target: PaymentDocument,
    source: PaymentDocument,
  ): void {
    const snapshot = source.toObject
      ? source.toObject({ depopulate: true })
      : source;
    if (typeof target.set === 'function') target.set(snapshot);
    else Object.assign(target, snapshot);
  }

  private isRetryableTransactionError(error: unknown): boolean {
    if (!error || typeof error !== 'object') return false;
    const candidate = error as {
      code?: number;
      name?: string;
      hasErrorLabel?: (label: string) => boolean;
    };
    return Boolean(
      candidate.code === 112 ||
      candidate.name === 'VersionError' ||
      candidate.hasErrorLabel?.('TransientTransactionError') ||
      candidate.hasErrorLabel?.('UnknownTransactionCommitResult'),
    );
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
    return this.operationalErrorLabel(error);
  }

  private operationalErrorLabel(error: unknown): string {
    const rawName =
      error instanceof Error && error.name ? error.name : 'UnknownError';
    const name =
      rawName.replace(/[^A-Za-z0-9_.:-]/g, '').slice(0, 80) || 'UnknownError';
    const rawCode =
      error && typeof error === 'object' && 'code' in error
        ? String((error as { code?: unknown }).code ?? '')
        : '';
    const code = /^[A-Za-z0-9_.:-]{1,64}$/.test(rawCode) ? rawCode : undefined;
    if (error instanceof PaymentProviderError) {
      const status =
        Number.isInteger(error.statusCode) && error.statusCode! >= 100
          ? `:http-${error.statusCode}`
          : '';
      return `${name}:${error.provider}${status}${code ? `:code-${code}` : ''}`;
    }
    return `${name}${code ? `:code-${code}` : ''}`;
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

  private async assertRefundAllowed(
    payment: PaymentDocument,
    session?: ClientSession,
  ): Promise<void> {
    if (!this.orderModel || !this.campaignModel || !this.awardModel) return;
    const orderQuery = this.orderModel
      .findById(payment.order)
      .select('titleNumbers');
    const campaignQuery = this.campaignModel
      .findById(payment.campaign)
      .select('status winningQuotaNumber');
    const awardQuery = this.awardModel
      .findOne({
        order: payment.order,
        status: PrizeAwardStatus.Fulfilled,
      })
      .select('_id');
    if (session) {
      orderQuery.session(session);
      campaignQuery.session(session);
      awardQuery.session(session);
    }
    const [order, campaign, fulfilledAward] = await Promise.all([
      orderQuery.lean(),
      campaignQuery.lean(),
      awardQuery.lean(),
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
