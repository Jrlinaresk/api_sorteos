import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectModel } from '@nestjs/mongoose';
import { randomUUID } from 'crypto';
import { ClientSession, FilterQuery, Model, Types } from 'mongoose';
import { TransactionalEmailService } from '../email/transactional-email.service';
import { NotificationsService } from '../notifications/notifications.service';
import { NotificationType } from '../notifications/schemas/notification.schema';
import { OrdersService } from '../orders/orders.service';
import { Order, OrderDocument } from '../orders/schemas/order.schema';
import {
  Quota,
  QuotaDocument,
  QuotaStatus,
} from '../orders/schemas/quota.schema';
import {
  DrawResultDocument,
  DrawResultStatus,
} from '../draws/schemas/draw-result.schema';
import { RaffleDocument } from '../riffles/schema/raffle.schema';
import {
  ClaimMainPrizeDto,
  MainPrizeDeliveryDto,
} from './dto/claim-main-prize.dto';
import { FulfillMainPrizeDto } from './dto/fulfill-main-prize.dto';
import { ListMainPrizeAwardsDto } from './dto/list-main-prize-awards.dto';
import { ListMyMainPrizeAwardsDto } from './dto/list-my-main-prize-awards.dto';
import {
  MainPrizeAward,
  MainPrizeAwardDocument,
  MainPrizeAwardStatus,
  MainPrizeChoice,
  MainPrizeClaimSource,
  MainPrizeDeliveryDetails,
} from './schemas/main-prize-award.schema';

const NOTIFICATION_LEASE_MILLISECONDS = 2 * 60 * 1_000;
const NOTIFICATION_BATCH_SIZE = 20;

@Injectable()
export class MainPrizeAwardsService {
  constructor(
    @InjectModel(MainPrizeAward.name)
    private readonly awardModel: Model<MainPrizeAwardDocument>,
    @InjectModel(Order.name)
    private readonly orderModel: Model<OrderDocument>,
    @InjectModel(Quota.name)
    private readonly quotaModel: Model<QuotaDocument>,
    private readonly orders: OrdersService,
    private readonly notifications: NotificationsService,
    private readonly transactionalEmail: TransactionalEmailService,
  ) {}

  /**
   * Se ejecuta dentro de la misma transacción que publica DrawResult. Así no
   * puede existir un resultado público sin su contrato de entrega (salvo datos
   * heredados, que el reintento idempotente de publish repara).
   */
  async ensureForPublishedResult(
    result: DrawResultDocument,
    campaign: RaffleDocument,
    session: ClientSession,
  ): Promise<MainPrizeAwardDocument> {
    if (result.status !== DrawResultStatus.Published) {
      throw new ConflictException(
        'El premio principal solo se crea al publicar el resultado',
      );
    }
    const outcome = result.outcomes?.[0];
    if (!outcome?.quota || !outcome.order) {
      throw new ConflictException(
        'El resultado no conserva cuota y pedido ganador',
      );
    }

    const [quota, order] = await Promise.all([
      this.quotaModel
        .findOne({
          _id: outcome.quota,
          campaign: campaign._id,
          order: outcome.order,
          status: { $in: [QuotaStatus.Paid, QuotaStatus.Awarded] },
        })
        .session(session)
        .exec(),
      this.orderModel
        .findOne({ _id: outcome.order, campaign: campaign._id })
        .session(session)
        .exec(),
    ]);
    if (!quota || !order) {
      throw new ConflictException(
        'La propiedad del título ganador no pudo verificarse',
      );
    }

    const identity = {
      campaign: campaign._id,
      drawResult: result._id,
      quota: quota._id,
      order: order._id,
    };
    const existing = await this.awardModel
      .findOne({
        $or: Object.entries(identity).map(([key, value]) => ({
          [key]: value,
        })),
      })
      .session(session)
      .exec();
    if (existing) {
      this.assertSameIdentity(existing, identity);
      this.assertSameContract(existing, campaign, order, outcome.winningNumber);
      return existing;
    }

    const awardedAt = result.publishedAt ?? new Date();
    const [created] = await this.awardModel.create(
      [
        {
          ...identity,
          orderPublicId: order.publicId,
          user: order.user,
          prizeTitle: campaign.prizeTitle,
          cashAlternative:
            typeof campaign.cashAlternative === 'number'
              ? campaign.cashAlternative
              : undefined,
          currency: campaign.currency || 'BRL',
          winningNumber: outcome.winningNumber,
          winnerSnapshot: {
            name: order.buyer.name,
            phone: order.buyer.phone,
            email: order.buyer.email,
          },
          status: MainPrizeAwardStatus.Pending,
          awardedAt,
          notificationAttempts: 0,
          notificationNextAttemptAt: awardedAt,
        },
      ],
      { session },
    );
    return created;
  }

  async findOwned(publicId: string, orderToken?: string, userId?: string) {
    const award = await this.loadByPublicId(publicId, true);
    await this.assertOwner(award, orderToken, userId);
    return this.ownerView(award);
  }

  async findOwnedByOrder(
    orderPublicId: string,
    orderToken?: string,
    userId?: string,
  ) {
    const order = await this.orders.findOwnedForCheckout(
      orderPublicId,
      orderToken,
      userId,
    );
    const award = await this.awardModel
      .findOne({ order: order._id })
      .select('+deliveryDetails')
      .exec();
    if (!award) throw new NotFoundException('Premio principal no encontrado');
    return this.ownerView(award);
  }

  async claimOwned(
    publicId: string,
    dto: ClaimMainPrizeDto,
    orderToken?: string,
    userId?: string,
  ) {
    const award = await this.loadByPublicId(publicId, true);
    await this.assertOwner(award, orderToken, userId);
    this.assertAvailableChoice(award, dto.choice);

    if (award.status !== MainPrizeAwardStatus.Pending) {
      if (award.choice !== dto.choice) {
        this.assertIdempotentChoice(award, dto.choice);
      }
      const deliveryDetails = this.deliveryForChoice(dto);
      this.assertIdempotentChoice(award, dto.choice, deliveryDetails);
      return this.ownerView(award);
    }

    const deliveryDetails = this.deliveryForChoice(dto);
    const accountOwner = Boolean(userId);
    const now = new Date();
    const updated = await this.awardModel
      .findOneAndUpdate(
        { _id: award._id, status: MainPrizeAwardStatus.Pending },
        {
          $set: {
            status: MainPrizeAwardStatus.Claimed,
            choice: dto.choice,
            ...(deliveryDetails ? { deliveryDetails } : {}),
            claimedAt: now,
            claimSource: accountOwner
              ? MainPrizeClaimSource.Account
              : MainPrizeClaimSource.OrderToken,
            ...(accountOwner
              ? { claimedByUser: new Types.ObjectId(userId) }
              : {}),
          },
        },
        { new: true, runValidators: true },
      )
      .select('+deliveryDetails')
      .exec();
    if (updated) return this.ownerView(updated);

    const raced = await this.awardModel
      .findById(award._id)
      .select('+deliveryDetails')
      .exec();
    if (!raced) throw new NotFoundException('Premio principal no encontrado');
    this.assertIdempotentChoice(raced, dto.choice, deliveryDetails);
    return this.ownerView(raced);
  }

  async listMine(userId: string, query: ListMyMainPrizeAwardsDto) {
    if (!Types.ObjectId.isValid(userId)) {
      throw new BadRequestException('Usuario inválido');
    }
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const orderIds = await this.orderModel
      .distinct('_id', { user: new Types.ObjectId(userId) })
      .exec();
    const filter: FilterQuery<MainPrizeAwardDocument> = {
      order: { $in: orderIds },
    };
    if (query.status) filter.status = query.status;
    if (query.campaignId) {
      filter.campaign = new Types.ObjectId(query.campaignId);
    }
    const [rows, total] = await Promise.all([
      this.awardModel
        .find(filter)
        .select('+deliveryDetails')
        .populate('campaign', 'name slug prizeTitle cashAlternative currency')
        .sort({ awardedAt: -1, _id: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .exec(),
      this.awardModel.countDocuments(filter).exec(),
    ]);
    return {
      data: rows.map((row) => this.ownerView(row)),
      meta: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
        hasNextPage: page * limit < total,
      },
    };
  }

  async listAdmin(query: ListMainPrizeAwardsDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const filter: FilterQuery<MainPrizeAwardDocument> = {};
    if (query.status) filter.status = query.status;
    if (query.campaignId) {
      filter.campaign = new Types.ObjectId(query.campaignId);
    }
    const [rows, total] = await Promise.all([
      this.awardModel
        .find(filter)
        .populate('campaign', 'name slug prizeTitle cashAlternative currency')
        .sort({ awardedAt: -1, _id: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean()
        .exec(),
      this.awardModel.countDocuments(filter).exec(),
    ]);
    return {
      data: rows.map((row) => this.adminView(row as MainPrizeAward)),
      meta: { page, limit, total, pages: Math.ceil(total / limit) },
    };
  }

  async findAdmin(publicId: string) {
    const award = await this.awardModel
      .findOne({ publicId })
      .select('+deliveryDetails')
      .populate('campaign', 'name slug prizeTitle cashAlternative currency')
      .populate('fulfilledBy', 'nickname name email')
      .lean()
      .exec();
    if (!award) throw new NotFoundException('Premio principal no encontrado');
    return this.adminView(award as MainPrizeAward);
  }

  async fulfill(publicId: string, dto: FulfillMainPrizeDto, actorId: string) {
    if (!Types.ObjectId.isValid(actorId)) {
      throw new BadRequestException('Actor de entrega inválido');
    }
    const reference = this.trimOptional(dto.reference);
    const notes = this.trimOptional(dto.notes);
    const award = await this.loadByPublicId(publicId, true);

    if (award.status === MainPrizeAwardStatus.Fulfilled) {
      this.assertIdempotentFulfillment(award, reference, notes);
      return this.adminView(award);
    }
    if (award.status !== MainPrizeAwardStatus.Claimed || !award.choice) {
      throw new ConflictException(
        'El ganador debe reclamar y elegir el premio antes de entregarlo',
      );
    }
    if (award.choice === MainPrizeChoice.Physical && !award.deliveryDetails) {
      throw new ConflictException(
        'El reclamo físico no contiene datos de entrega verificables',
      );
    }

    const updated = await this.awardModel
      .findOneAndUpdate(
        { _id: award._id, status: MainPrizeAwardStatus.Claimed },
        {
          $set: {
            status: MainPrizeAwardStatus.Fulfilled,
            fulfilledAt: new Date(),
            fulfilledBy: new Types.ObjectId(actorId),
            ...(reference ? { fulfillmentReference: reference } : {}),
            ...(notes ? { fulfillmentNotes: notes } : {}),
          },
        },
        { new: true, runValidators: true },
      )
      .select('+deliveryDetails')
      .exec();
    if (updated) return this.adminView(updated);

    const raced = await this.awardModel
      .findById(award._id)
      .select('+deliveryDetails')
      .exec();
    if (!raced) throw new NotFoundException('Premio principal no encontrado');
    if (raced.status !== MainPrizeAwardStatus.Fulfilled) {
      throw new ConflictException('El estado del premio cambió');
    }
    this.assertIdempotentFulfillment(raced, reference, notes);
    return this.adminView(raced);
  }

  /** Repara de forma idempotente avisos que no terminaron tras el commit. */
  @Cron('17 */2 * * * *')
  async repairPublishedAwardNotifications(): Promise<number> {
    let processed = 0;
    for (let index = 0; index < NOTIFICATION_BATCH_SIZE; index += 1) {
      const candidate = await this.awardModel
        .findOne(this.dueNotificationFilter(new Date()))
        .sort({ notificationNextAttemptAt: 1, awardedAt: 1 })
        .select('_id')
        .lean()
        .exec();
      if (!candidate) break;
      await this.tryNotifyAward(candidate._id.toString());
      processed += 1;
    }
    return processed;
  }

  async tryNotifyAward(awardId: string | Types.ObjectId): Promise<boolean> {
    if (!Types.ObjectId.isValid(awardId.toString())) return false;
    const now = new Date();
    const leaseToken = randomUUID();
    const award = await this.awardModel
      .findOneAndUpdate(
        {
          _id: new Types.ObjectId(awardId.toString()),
          ...this.dueNotificationFilter(now),
        },
        {
          $set: {
            notificationLeaseToken: leaseToken,
            notificationLeaseExpiresAt: new Date(
              now.getTime() + NOTIFICATION_LEASE_MILLISECONDS,
            ),
          },
          $inc: { notificationAttempts: 1 },
        },
        { new: true },
      )
      .select('+notificationLeaseToken +notificationLeaseExpiresAt')
      .exec();
    if (!award) {
      const completed = await this.awardModel.exists({
        _id: new Types.ObjectId(awardId.toString()),
        notificationCompletedAt: { $exists: true },
      });
      return Boolean(completed);
    }

    const failures: unknown[] = [];
    try {
      if (award.user && !award.inboxNotificationQueuedAt) {
        try {
          await this.notifications.create({
            userId: award.user.toString(),
            title: '¡Tu título resultó ganador!',
            body: `El título ${award.winningNumber} ganó ${award.prizeTitle}. Reclama tu premio.`,
            type: NotificationType.Winner,
            eventKey: this.inboxEventKey(award.publicId),
            data: {
              awardId: award.publicId,
              campaignId: award.campaign.toString(),
              winningNumber: award.winningNumber,
            },
            actionUrl: `/premios/${award.publicId}`,
            deliverPush: true,
          });
          const queuedAt = new Date();
          await this.persistNotificationMarker(
            award._id,
            leaseToken,
            'inboxNotificationQueuedAt',
            queuedAt,
          );
          award.inboxNotificationQueuedAt = queuedAt;
        } catch (error) {
          failures.push(error);
        }
      }

      if (!award.emailNotificationQueuedAt) {
        try {
          await this.transactionalEmail.enqueueAndDeliver({
            eventKey: this.emailEventKey(award.publicId),
            recipient: award.winnerSnapshot.email,
            subject: 'Tu título ganó el premio principal',
            body: this.winnerEmailBody(award),
          });
          const queuedAt = new Date();
          await this.persistNotificationMarker(
            award._id,
            leaseToken,
            'emailNotificationQueuedAt',
            queuedAt,
          );
          award.emailNotificationQueuedAt = queuedAt;
        } catch (error) {
          failures.push(error);
        }
      }

      const allQueued = Boolean(
        award.emailNotificationQueuedAt &&
        (!award.user || award.inboxNotificationQueuedAt),
      );
      if (failures.length || !allQueued) {
        throw failures[0] ?? new Error('Notificación incompleta');
      }
      const completed = await this.awardModel.updateOne(
        { _id: award._id, notificationLeaseToken: leaseToken },
        {
          $set: { notificationCompletedAt: new Date() },
          $unset: {
            notificationLeaseToken: 1,
            notificationLeaseExpiresAt: 1,
            lastNotificationError: 1,
          },
        },
      );
      return completed.modifiedCount === 1;
    } catch (error) {
      const attempts = Math.max(1, award.notificationAttempts ?? 1);
      const delay = Math.min(
        60 * 60 * 1_000,
        30_000 * 2 ** Math.min(7, attempts - 1),
      );
      await this.awardModel.updateOne(
        { _id: award._id, notificationLeaseToken: leaseToken },
        {
          $set: {
            notificationNextAttemptAt: new Date(Date.now() + delay),
            lastNotificationError: this.safeErrorName(error),
          },
          $unset: {
            notificationLeaseToken: 1,
            notificationLeaseExpiresAt: 1,
          },
        },
      );
      return false;
    }
  }

  private async assertOwner(
    award: MainPrizeAwardDocument,
    orderToken?: string,
    userId?: string,
  ): Promise<void> {
    const order = await this.orders.findOwnedForCheckout(
      award.orderPublicId,
      orderToken,
      userId,
    );
    if (order._id.toString() !== award.order.toString()) {
      throw new ConflictException(
        'El pedido propietario no coincide con el contrato del premio',
      );
    }
  }

  private async loadByPublicId(
    publicId: string,
    includeDelivery = false,
  ): Promise<MainPrizeAwardDocument> {
    const normalized = publicId?.trim();
    if (!normalized || normalized.length > 80) {
      throw new BadRequestException('Identificador de premio inválido');
    }
    const query = this.awardModel.findOne({ publicId: normalized });
    if (includeDelivery) query.select('+deliveryDetails');
    const award = await query.exec();
    if (!award) throw new NotFoundException('Premio principal no encontrado');
    return award;
  }

  private assertAvailableChoice(
    award: MainPrizeAwardDocument,
    choice: MainPrizeChoice,
  ): void {
    if (
      choice === MainPrizeChoice.Cash &&
      !(typeof award.cashAlternative === 'number' && award.cashAlternative > 0)
    ) {
      throw new ConflictException(
        'Esta campaña no ofrece una alternativa válida en efectivo',
      );
    }
  }

  private assertIdempotentChoice(
    award: MainPrizeAwardDocument,
    choice: MainPrizeChoice,
    deliveryDetails?: MainPrizeDeliveryDetails,
  ): void {
    if (award.choice !== choice) {
      throw new ConflictException(
        `El premio ya fue reclamado con la opción ${award.choice}`,
      );
    }
    if (
      choice === MainPrizeChoice.Physical &&
      !this.sameDelivery(award.deliveryDetails, deliveryDetails)
    ) {
      throw new ConflictException(
        'El premio físico ya fue reclamado con otros datos de entrega',
      );
    }
  }

  private deliveryForChoice(
    dto: ClaimMainPrizeDto,
  ): MainPrizeDeliveryDetails | undefined {
    if (dto.choice === MainPrizeChoice.Cash) {
      if (dto.delivery) {
        throw new BadRequestException(
          'Los datos de entrega solo corresponden al premio físico',
        );
      }
      return undefined;
    }
    if (!dto.delivery) {
      throw new BadRequestException(
        'Los datos de entrega son obligatorios para el premio físico',
      );
    }
    return this.normalizeDelivery(dto.delivery);
  }

  private normalizeDelivery(
    delivery: MainPrizeDeliveryDto,
  ): MainPrizeDeliveryDetails {
    const recipientName = delivery.recipientName.trim().replace(/\s+/g, ' ');
    const phone = delivery.phone.trim().replace(/\s+/g, ' ');
    const address = delivery.address.trim().replace(/\s+/g, ' ');
    const instructions = this.trimOptional(delivery.instructions);
    if (
      recipientName.length < 2 ||
      recipientName.length > 160 ||
      phone.length > 24 ||
      !/^(?=(?:\D*\d){8,15}\D*$)\+?[0-9() .-]+$/.test(phone) ||
      address.length < 10 ||
      address.length > 500 ||
      (instructions?.length ?? 0) > 1_000
    ) {
      throw new BadRequestException('Datos de entrega inválidos');
    }
    return {
      recipientName,
      phone,
      address,
      ...(instructions ? { instructions } : {}),
    };
  }

  private sameDelivery(
    existing?: MainPrizeDeliveryDetails,
    received?: MainPrizeDeliveryDetails,
  ): boolean {
    if (!existing || !received) return existing === received;
    return (
      existing.recipientName === received.recipientName &&
      existing.phone === received.phone &&
      existing.address === received.address &&
      (existing.instructions || undefined) ===
        (received.instructions || undefined)
    );
  }

  private assertIdempotentFulfillment(
    award: MainPrizeAwardDocument,
    reference?: string,
    notes?: string,
  ): void {
    if (
      (reference && award.fulfillmentReference !== reference) ||
      (notes && award.fulfillmentNotes !== notes)
    ) {
      throw new ConflictException(
        'El premio ya fue entregado con otro comprobante',
      );
    }
  }

  private assertSameIdentity(
    award: MainPrizeAwardDocument,
    identity: {
      campaign: Types.ObjectId;
      drawResult: Types.ObjectId;
      quota: Types.ObjectId;
      order: Types.ObjectId;
    },
  ): void {
    for (const [key, expected] of Object.entries(identity)) {
      const actual = (award as unknown as Record<string, Types.ObjectId>)[key];
      if (actual?.toString() !== expected.toString()) {
        throw new ConflictException(
          'Una entidad ganadora ya pertenece a otro premio principal',
        );
      }
    }
  }

  private assertSameContract(
    award: MainPrizeAwardDocument,
    campaign: RaffleDocument,
    order: OrderDocument,
    winningNumber: string,
  ): void {
    const expectedCashAlternative =
      typeof campaign.cashAlternative === 'number'
        ? campaign.cashAlternative
        : undefined;
    const same =
      award.orderPublicId === order.publicId &&
      award.user?.toString() === order.user?.toString() &&
      award.prizeTitle === campaign.prizeTitle &&
      award.cashAlternative === expectedCashAlternative &&
      award.currency === (campaign.currency || 'BRL') &&
      award.winningNumber === winningNumber &&
      award.winnerSnapshot.name === order.buyer.name &&
      award.winnerSnapshot.phone === order.buyer.phone &&
      award.winnerSnapshot.email === order.buyer.email;
    if (!same) {
      throw new ConflictException(
        'El contrato existente del premio no coincide con el resultado publicado',
      );
    }
  }

  private dueNotificationFilter(
    now: Date,
  ): FilterQuery<MainPrizeAwardDocument> {
    return {
      notificationCompletedAt: { $exists: false },
      notificationNextAttemptAt: { $lte: now },
      $or: [
        { notificationLeaseExpiresAt: { $exists: false } },
        { notificationLeaseExpiresAt: { $lte: now } },
      ],
    };
  }

  private async persistNotificationMarker(
    awardId: Types.ObjectId,
    leaseToken: string,
    field: 'inboxNotificationQueuedAt' | 'emailNotificationQueuedAt',
    value: Date,
  ): Promise<void> {
    const updated = await this.awardModel.updateOne(
      { _id: awardId, notificationLeaseToken: leaseToken },
      { $set: { [field]: value } },
    );
    if (updated.modifiedCount !== 1) {
      throw new ConflictException('Se perdió el lease de notificación');
    }
  }

  private inboxEventKey(publicId: string): string {
    return `main-award:${publicId}:inbox`;
  }

  private emailEventKey(publicId: string): string {
    return `main-award:${publicId}:email`;
  }

  private winnerEmailBody(award: MainPrizeAwardDocument): string {
    return [
      `Hola ${award.winnerSnapshot.name},`,
      '',
      `Tu título ${award.winningNumber} ganó ${award.prizeTitle}.`,
      `Identificador del premio: ${award.publicId}`,
      `Pedido: ${award.orderPublicId}`,
      '',
      'Ingresa al sitio para reclamar y elegir la modalidad disponible.',
    ].join('\n');
  }

  private trimOptional(value?: string): string | undefined {
    const normalized = value?.trim();
    return normalized || undefined;
  }

  private safeErrorName(error: unknown): string {
    const name = error instanceof Error ? error.name : 'UnknownError';
    return `${name}: notification scheduling failed`.slice(0, 500);
  }

  private ownerView(award: MainPrizeAwardDocument) {
    const raw = award.toObject() as unknown as Record<string, unknown>;
    const populatedCampaign = raw.campaign as
      | {
          _id?: { toString(): string };
          name?: unknown;
          slug?: unknown;
          prizeTitle?: unknown;
          currency?: unknown;
        }
      | undefined;
    const campaignId =
      populatedCampaign?._id?.toString() ?? award.campaign.toString();
    const campaign =
      populatedCampaign &&
      (typeof populatedCampaign.name === 'string' ||
        typeof populatedCampaign.slug === 'string')
        ? {
            id: campaignId,
            ...(typeof populatedCampaign.name === 'string'
              ? { name: populatedCampaign.name }
              : {}),
            ...(typeof populatedCampaign.slug === 'string'
              ? { slug: populatedCampaign.slug }
              : {}),
            ...(typeof populatedCampaign.prizeTitle === 'string'
              ? { prizeTitle: populatedCampaign.prizeTitle }
              : {}),
            ...(typeof populatedCampaign.currency === 'string'
              ? { currency: populatedCampaign.currency }
              : {}),
          }
        : undefined;
    delete raw._id;
    delete raw.__v;
    delete raw.campaign;
    delete raw.drawResult;
    delete raw.quota;
    delete raw.order;
    delete raw.claimedByUser;
    delete raw.fulfilledBy;
    delete raw.fulfillmentNotes;
    delete raw.inboxNotificationQueuedAt;
    delete raw.emailNotificationQueuedAt;
    delete raw.notificationCompletedAt;
    delete raw.notificationAttempts;
    delete raw.notificationNextAttemptAt;
    delete raw.notificationLeaseToken;
    delete raw.notificationLeaseExpiresAt;
    delete raw.lastNotificationError;
    return {
      ...raw,
      campaignId,
      ...(campaign ? { campaign } : {}),
      availableChoices:
        typeof award.cashAlternative === 'number' && award.cashAlternative > 0
          ? [MainPrizeChoice.Physical, MainPrizeChoice.Cash]
          : [MainPrizeChoice.Physical],
    };
  }

  private adminView(award: MainPrizeAward | MainPrizeAwardDocument) {
    const raw =
      typeof (award as MainPrizeAwardDocument).toObject === 'function'
        ? ((award as MainPrizeAwardDocument).toObject() as unknown as Record<
            string,
            unknown
          >)
        : ({ ...(award as unknown as Record<string, unknown>) } as Record<
            string,
            unknown
          >);
    delete raw.__v;
    delete raw.notificationLeaseToken;
    delete raw.notificationLeaseExpiresAt;
    return raw;
  }
}
