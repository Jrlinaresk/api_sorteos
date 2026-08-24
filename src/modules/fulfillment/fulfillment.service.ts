import {
  HttpException,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { TransactionalEmailService } from '../email/transactional-email.service';
import { NotificationsService } from '../notifications/notifications.service';
import { NotificationType } from '../notifications/schemas/notification.schema';
import { OrderDocument, OrderStatus } from '../orders/schemas/order.schema';
import { OrdersService } from '../orders/orders.service';
import { PaymentStatus } from '../payments/payment.enums';
import {
  PaymentLifecycleEvent,
  PaymentLifecycleHooks,
  PaymentsService,
} from '../payments/payments.service';
import { PrizesService } from '../prizes/prizes.service';
import { ReferralAttributionService } from '../referrals/referral-attribution.service';

@Injectable()
export class FulfillmentService
  implements OnModuleInit, OnModuleDestroy, PaymentLifecycleHooks
{
  private readonly logger = new Logger(FulfillmentService.name);
  private unregisterHooks?: () => void;

  constructor(
    private readonly payments: PaymentsService,
    private readonly orders: OrdersService,
    private readonly prizes: PrizesService,
    private readonly referrals: ReferralAttributionService,
    private readonly notifications: NotificationsService,
    private readonly transactionalEmail: TransactionalEmailService,
  ) {}

  onModuleInit() {
    this.unregisterHooks = this.payments.registerLifecycleHooks(this);
  }

  onModuleDestroy() {
    this.unregisterHooks?.();
  }

  async onPaymentPaid(event: PaymentLifecycleEvent) {
    const order = await this.orders.markPaidByPayment(
      event.paymentId,
      new Date(),
    );
    if (!order) return;

    await this.prizes.awardForPaidOrder(order._id);
    await this.notify(
      order,
      {
        title: 'Pago confirmado',
        body: 'Tus títulos ya están disponibles en tu cuenta.',
        type: NotificationType.Payment,
      },
      event,
    );
    await this.attributeReferral(order);
  }

  async onPaymentCancelled(event: PaymentLifecycleEvent) {
    const order = await this.orders.markPaymentCancelled(
      event.paymentId,
      event.status === PaymentStatus.Expired
        ? OrderStatus.Expired
        : OrderStatus.Cancelled,
      `Pago ${event.status}`,
    );
    if (!order) return;
    await this.referrals.reverseOrder(order.publicId, `Pedido ${order.status}`);
    await this.notify(
      order,
      {
        title:
          event.status === PaymentStatus.Expired
            ? 'Reserva vencida'
            : 'Pedido cancelado',
        body: 'Las cuotas reservadas fueron liberadas.',
        type: NotificationType.Order,
      },
      event,
    );
  }

  async onPaymentRefunded(event: PaymentLifecycleEvent) {
    if (event.status !== PaymentStatus.Refunded) return;
    const order: OrderDocument | null =
      (await this.orders.markRefundedByPayment(
        event.paymentId,
        'Devolución total confirmada por el proveedor',
      )) as OrderDocument | null;
    if (!order) return;
    await this.prizes.reverseForOrder(order._id);
    await this.referrals.reverseOrder(order.publicId, 'Pedido reembolsado');
    await this.notify(
      order,
      {
        title: 'Pago reembolsado',
        body: 'La devolución del pedido fue confirmada.',
        type: NotificationType.Payment,
      },
      event,
    );
  }

  private async attributeReferral(order: OrderDocument) {
    const referralCode = order.attribution?.referralCode;
    const clickId = order.attribution?.referralClickId;
    if (!referralCode && !clickId) return;
    try {
      await this.referrals.attributeOrder({
        orderId: order.publicId,
        referralCode,
        clickId,
        buyerUserId: order.user?.toString(),
        buyerPhone: order.buyer.phone,
        buyerEmail: order.buyer.email,
        buyerCpf: order.buyer.cpf,
        campaignId: order.campaign.toString(),
        orderAmount: order.total,
        commissionBase: order.subtotal,
        currency: order.currency,
      });
      await this.referrals.approveOrder(order.publicId);
    } catch (error) {
      if (error instanceof HttpException && error.getStatus() < 500) {
        this.logNonCritical('atribución de referido no aplicable', error);
        return;
      }
      throw error;
    }
  }

  private async notify(
    order: OrderDocument,
    message: { title: string; body: string; type: NotificationType },
    event: PaymentLifecycleEvent,
  ) {
    const eventKey = `fulfillment:${event.paymentId}:${event.status}`;
    if (order.user) {
      await this.notifications.create({
        userId: order.user.toString(),
        ...message,
        eventKey,
        data: {
          orderId: order.publicId,
          campaignId: order.campaign.toString(),
        },
        actionUrl: `/pedidos/${order.publicId}`,
        deliverPush: true,
      });
      return;
    }
    await this.transactionalEmail.enqueueAndDeliver({
      eventKey,
      recipient: order.buyer.email,
      subject: message.title,
      body: `${message.body}\n\nPedido: ${order.publicId}`,
    });
  }

  private logNonCritical(context: string, error: unknown) {
    const label =
      error instanceof HttpException
        ? `${error.name}:http-${error.getStatus()}`
        : error instanceof Error
          ? error.name
          : 'UnknownError';
    this.logger.warn(
      `No se completó ${context} (${label.replace(/[^A-Za-z0-9_.:-]/g, '').slice(0, 80) || 'UnknownError'})`,
    );
  }
}
