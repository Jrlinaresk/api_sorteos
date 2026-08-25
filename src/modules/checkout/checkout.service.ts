import {
  BadRequestException,
  ConflictException,
  Injectable,
  OnModuleDestroy,
  OnModuleInit,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { Types } from 'mongoose';
import { CancelOrderDto } from '../orders/dto/cancel-order.dto';
import { OrderStatus } from '../orders/schemas/order.schema';
import { OrdersService } from '../orders/orders.service';
import { PaymentCurrency, PaymentStatus } from '../payments/payment.enums';
import {
  CreatePaymentResult,
  PaymentLifecycleEvent,
  PaymentLifecycleHooks,
  PaymentsService,
} from '../payments/payments.service';
import { CreatePaymentDto } from '../payments/dto/create-payment.dto';
import { CreateCheckoutDto } from './dto/create-checkout.dto';

const USABLE_PAYMENT_STATUSES = new Set<PaymentStatus>([
  PaymentStatus.Pending,
  PaymentStatus.Active,
  PaymentStatus.Paid,
  PaymentStatus.UnderReview,
  PaymentStatus.RefundPending,
  PaymentStatus.PartiallyRefunded,
  PaymentStatus.Refunded,
]);

@Injectable()
export class CheckoutService
  implements OnModuleInit, OnModuleDestroy, PaymentLifecycleHooks
{
  private unregisterHooks?: () => void;

  constructor(
    private readonly orders: OrdersService,
    private readonly payments: PaymentsService,
  ) {}

  onModuleInit(): void {
    this.unregisterHooks = this.payments.registerLifecycleHooks(this);
  }

  onModuleDestroy(): void {
    this.unregisterHooks?.();
  }

  async create(dto: CreateCheckoutDto, authenticatedUserId?: string) {
    const reserved = (await this.orders.createReservation(
      dto,
      authenticatedUserId,
    )) as Record<string, any>;
    const orderId = this.objectIdOf(reserved.internalId ?? reserved._id);
    const publicId = String(reserved.publicId ?? reserved.id);
    const orderAccessToken = String(reserved.accessToken ?? '');
    const campaignId = this.objectIdOf(
      reserved.campaign?._id ?? reserved.campaign,
    );
    const paymentUserId = reserved.user
      ? this.objectIdOf(reserved.user?._id ?? reserved.user)
      : undefined;

    if (
      ![
        OrderStatus.Reserved,
        OrderStatus.PendingPayment,
        OrderStatus.Paid,
      ].includes(reserved.status)
    ) {
      throw new ConflictException(
        `El checkout idempotente ya terminó con estado ${reserved.status}`,
      );
    }
    if (reserved.currency !== PaymentCurrency.BRL) {
      await this.rollbackReservation(orderId, 'Moneda de pedido no soportada');
      throw new BadRequestException('El checkout Pix solo admite BRL');
    }

    const paymentDto: CreatePaymentDto = {
      orderId,
      campaignId,
      userId: paymentUserId,
      amount: Number(reserved.total),
      currency: PaymentCurrency.BRL,
      idempotencyKey: `checkout:${orderId}`,
      expiresInSeconds: this.paymentExpirationSeconds(reserved.expiresAt),
      description: `Pedido ${publicId}`.slice(0, 140),
      payer: {
        name: String(reserved.buyer.name),
        cpf: String(reserved.buyer.cpf),
      },
    };

    let paymentResult: CreatePaymentResult;
    try {
      paymentResult = await this.createOrRecoverPayment(paymentDto);
    } catch (error) {
      await this.rollbackReservation(
        orderId,
        'No fue posible crear o conciliar el cobro Pix',
      );
      throw error;
    }

    try {
      await this.orders.attachPayment(orderId, paymentResult.payment._id);
      await this.payments.retryLifecycleHooks(
        paymentResult.payment._id.toString(),
      );
    } catch (error) {
      await this.payments
        .cancel(
          paymentResult.payment._id.toString(),
          'No fue posible asociar el pago al pedido',
        )
        .catch(() => undefined);
      await this.rollbackReservation(
        orderId,
        'No fue posible asociar el pago al pedido',
      );
      throw error;
    }

    return {
      order: await this.orders.findByPublicId(
        publicId,
        authenticatedUserId ? undefined : orderAccessToken,
        authenticatedUserId,
      ),
      payment: this.payments.toPublicView(paymentResult.payment),
      ...(authenticatedUserId
        ? {}
        : {
            orderAccessToken,
            paymentAccessSecret: paymentResult.accessSecret,
          }),
      idempotentReplay:
        Boolean(paymentResult.idempotentReplay) ||
        reserved.status !== OrderStatus.Reserved,
    };
  }

  async find(publicId: string, orderAccessToken: string, userId?: string) {
    return {
      order: await this.orders.findByPublicId(
        publicId,
        orderAccessToken,
        userId,
      ),
    };
  }

  async cancel(
    publicId: string,
    orderAccessToken: string,
    dto: CancelOrderDto,
    userId?: string,
  ) {
    const order = await this.orders.findOwnedForCheckout(
      publicId,
      orderAccessToken,
      userId,
    );
    if (!order.payment) {
      return {
        order: await this.orders.cancel(
          publicId,
          dto.reason,
          orderAccessToken,
          userId,
        ),
      };
    }

    const payment = await this.payments.findById(order.payment.toString());
    if (
      [
        PaymentStatus.Created,
        PaymentStatus.Pending,
        PaymentStatus.Active,
        PaymentStatus.Failed,
      ].includes(payment.status)
    ) {
      await this.payments.cancel(payment._id.toString(), dto.reason);
    } else if (
      ![
        PaymentStatus.Cancelled,
        PaymentStatus.Expired,
        PaymentStatus.Rejected,
      ].includes(payment.status)
    ) {
      throw new ConflictException(
        `El pago en estado ${payment.status} no puede ser cancelado`,
      );
    }

    const target =
      payment.status === PaymentStatus.Expired
        ? OrderStatus.Expired
        : OrderStatus.Cancelled;
    await this.orders.markPaymentCancelled(
      payment._id,
      target,
      dto.reason || 'Checkout cancelado por el comprador',
    );
    return {
      order: await this.orders.findByPublicId(
        publicId,
        orderAccessToken,
        userId,
      ),
    };
  }

  @Cron('*/30 * * * * *')
  async expirePayments(): Promise<number> {
    return this.payments.expireDuePayments();
  }

  async onPaymentPaid(event: PaymentLifecycleEvent): Promise<void> {
    await this.orders.markPaidByPayment(event.paymentId, new Date());
  }

  async onPaymentCancelled(event: PaymentLifecycleEvent): Promise<void> {
    await this.orders.markPaymentCancelled(
      event.paymentId,
      event.status === PaymentStatus.Expired
        ? OrderStatus.Expired
        : OrderStatus.Cancelled,
      `Pago ${event.status}`,
    );
  }

  async onPaymentRefunded(event: PaymentLifecycleEvent): Promise<void> {
    if (event.status === PaymentStatus.Refunded) {
      await this.orders.markRefundedByPayment(
        event.paymentId,
        'Devolución total confirmada por el proveedor',
      );
      return;
    }
    await this.orders.markPaymentReview(
      event.paymentId,
      `Pago ${event.status}`,
    );
  }

  async onPaymentStatusChanged(event: PaymentLifecycleEvent): Promise<void> {
    if (
      [
        PaymentStatus.UnderReview,
        PaymentStatus.Disputed,
        PaymentStatus.Chargeback,
        PaymentStatus.Rejected,
        PaymentStatus.Failed,
        PaymentStatus.RefundPending,
      ].includes(event.status)
    ) {
      await this.orders.markPaymentReview(
        event.paymentId,
        `Pago ${event.status}`,
      );
    }
  }

  private async createOrRecoverPayment(
    dto: CreatePaymentDto,
  ): Promise<CreatePaymentResult> {
    let result: CreatePaymentResult | undefined;
    let originalError: unknown;
    try {
      result = await this.payments.create(dto);
    } catch (error) {
      originalError = error;
    }
    if (result && USABLE_PAYMENT_STATUSES.has(result.payment.status)) {
      return result;
    }

    const existing =
      result?.payment ??
      (await this.payments.findByIdempotencyKey(dto.idempotencyKey));
    if (existing) {
      try {
        const reconciled = await this.payments.reconcile(
          existing._id.toString(),
        );
        if (USABLE_PAYMENT_STATUSES.has(reconciled.status)) {
          const replay = await this.payments.create(dto);
          replay.payment = reconciled;
          return replay;
        }
      } catch {
        // El error original es más útil y se conserva abajo.
      }
    }
    if (originalError) throw originalError;
    throw new ServiceUnavailableException(
      'El proveedor no dejó un cobro Pix utilizable',
    );
  }

  private async rollbackReservation(orderId: string, reason: string) {
    await this.orders
      .cancelByIdSystem(orderId, OrderStatus.Cancelled, reason)
      .catch(() => undefined);
  }

  private objectIdOf(value: unknown): string {
    const id = String(value ?? '');
    if (!Types.ObjectId.isValid(id)) {
      throw new ServiceUnavailableException(
        'El pedido no devolvió una referencia interna válida',
      );
    }
    return id;
  }

  private paymentExpirationSeconds(expiresAt: unknown): number {
    const milliseconds = new Date(String(expiresAt)).getTime() - Date.now();
    if (!Number.isFinite(milliseconds)) {
      throw new ServiceUnavailableException(
        'El pedido no devolvió una expiración válida',
      );
    }
    return Math.min(
      30 * 24 * 60 * 60,
      Math.max(60, Math.ceil(milliseconds / 1000)),
    );
  }
}
