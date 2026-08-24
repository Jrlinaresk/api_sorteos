import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  Optional,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Cron } from '@nestjs/schedule';
import { randomUUID } from 'node:crypto';
import { FilterQuery, Model, Types } from 'mongoose';
import { CreateNotificationDto } from './dto/create-notification.dto';
import { ListNotificationsQueryDto } from './dto/list-notifications-query.dto';
import { ListAdminNotificationsDto } from './dto/list-admin-notifications.dto';
import { RegisterPushSubscriptionDto } from './dto/register-push-subscription.dto';
import { UpdateNotificationPreferencesDto } from './dto/update-notification-preferences.dto';
import {
  canDeliverPushIgnoringQuietHours,
  isInsideQuietHours,
  nextAllowedPushAt,
} from './notification-policy';
import {
  NotificationPreferenceView,
  PublicNotificationView,
  PushSubscriptionView,
  toNotificationPreference,
  toAdminNotification,
  toPublicNotification,
  toPushSubscription,
} from './notification.presenter';
import {
  NOTIFICATION_PUSH_PROVIDER,
  NotificationPushProvider,
  PushDeliveryResult,
  PushPublicConfiguration,
} from './push/notification-push-provider';
import {
  InvalidWebPushSubscriptionError,
  validateWebPushSubscription,
} from './push/web-push-subscription';
import { readWebPushMaxSubscriptionsPerUser } from './push/web-push.config';
import {
  Notification,
  NotificationDeliveryCode,
  NotificationDeliveryStatus,
  NotificationDocument,
  NotificationType,
} from './schemas/notification.schema';
import {
  NotificationPreference,
  NotificationPreferenceDocument,
} from './schemas/notification-preference.schema';
import {
  PushSubscription,
  PushProviderKind,
  PushSubscriptionDisableReason,
  PushSubscriptionDocument,
} from './schemas/push-subscription.schema';

export interface NotificationPage {
  items: PublicNotificationView[];
  page: number;
  limit: number;
  total: number;
  unread: number;
}

interface DeliveryStateDetails {
  provider?: string;
  code?: string;
  accepted?: number;
  rejected?: number;
  invalidSubscriptions?: number;
}

interface DeliveryStateOptions {
  pushRequested?: boolean;
  scheduledAt?: Date;
}

// El timeout Web Push máximo permitido es 120 s. Cinco minutos cubren esa
// llamada y permiten recuperar pronto un proceso caído antes del dispatch;
// el heartbeat extiende el lease mientras el worker siga vivo.
const DELIVERY_LEASE_MILLISECONDS = 5 * 60 * 1_000;
const DELIVERY_LEASE_HEARTBEAT_MILLISECONDS = 60 * 1_000;
const MAX_AUTOMATIC_DELIVERY_ATTEMPTS = 5;
const RETRY_BASE_MILLISECONDS = 30 * 1_000;
const RETRY_MAX_MILLISECONDS = 30 * 60 * 1_000;
const DELIVERY_WORKER_BATCH_SIZE = 25;
const DELIVERY_WORKER_CONCURRENCY = 5;

@Injectable()
export class NotificationsService {
  constructor(
    @InjectModel(Notification.name)
    private readonly notificationModel: Model<NotificationDocument>,
    @InjectModel(PushSubscription.name)
    private readonly subscriptionModel: Model<PushSubscriptionDocument>,
    @InjectModel(NotificationPreference.name)
    private readonly preferenceModel: Model<NotificationPreferenceDocument>,
    @Optional()
    @Inject(NOTIFICATION_PUSH_PROVIDER)
    private readonly pushProvider?: NotificationPushProvider,
    @Optional()
    private readonly config?: ConfigService,
  ) {}

  getPushPublicConfiguration(): PushPublicConfiguration {
    return (
      this.pushProvider?.getPublicConfiguration() ?? {
        enabled: false,
        provider: 'none',
      }
    );
  }

  async create(
    dto: CreateNotificationDto,
    createdBy?: string,
  ): Promise<NotificationDocument> {
    const {
      userId,
      deliverPush = false,
      expiresAt,
      eventKey,
      ...content
    } = dto;
    const user = this.toObjectId(userId, 'usuario');
    const normalizedEventKey = eventKey?.trim();

    if (normalizedEventKey) {
      const existing = await this.findByEventKey(user, normalizedEventKey);
      if (existing) return existing;
    }

    let notification: NotificationDocument;
    try {
      notification = await this.notificationModel.create({
        ...content,
        user,
        eventKey: normalizedEventKey,
        type: dto.type ?? NotificationType.General,
        createdBy: createdBy?.slice(0, 120),
        expiresAt: expiresAt ? new Date(expiresAt) : undefined,
        pushRequested: deliverPush,
        scheduledAt: deliverPush ? new Date() : undefined,
      });
    } catch (error) {
      if (normalizedEventKey && this.isDuplicateKey(error)) {
        const existing = await this.findByEventKey(user, normalizedEventKey);
        if (existing) return existing;
      }
      throw error;
    }

    if (deliverPush) {
      await this.deliverPush(notification.id);
      return this.getById(notification.id);
    }

    return notification;
  }

  async listForUser(
    userId: string,
    query: ListNotificationsQueryDto,
  ): Promise<NotificationPage> {
    const user = this.toObjectId(userId, 'usuario');
    const page = this.boundedInteger(query.page, 1, 1, 1_000_000);
    const limit = this.boundedInteger(query.limit, 20, 1, 100);
    const filter: FilterQuery<NotificationDocument> = {
      user,
      $or: [
        { expiresAt: { $exists: false } },
        { expiresAt: { $gt: new Date() } },
      ],
    };

    if (query.unreadOnly === 'true') filter.readAt = { $exists: false };
    if (query.type) filter.type = query.type;

    const unreadFilter: FilterQuery<NotificationDocument> = {
      user,
      readAt: { $exists: false },
      $or: [
        { expiresAt: { $exists: false } },
        { expiresAt: { $gt: new Date() } },
      ],
    };

    const [items, total, unread] = await Promise.all([
      this.notificationModel
        .find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean()
        .exec(),
      this.notificationModel.countDocuments(filter).exec(),
      this.notificationModel.countDocuments(unreadFilter).exec(),
    ]);

    return {
      items: (items as Notification[]).map(toPublicNotification),
      page,
      limit,
      total,
      unread,
    };
  }

  async listAdmin(query: ListAdminNotificationsDto) {
    const page = query.page || 1;
    const limit = query.limit || 25;
    const filter: FilterQuery<NotificationDocument> = {};
    if (query.userId) filter.user = new Types.ObjectId(query.userId);
    if (query.type) filter.type = query.type;
    if (query.deliveryStatus) filter.deliveryStatus = query.deliveryStatus;
    const [rows, total] = await Promise.all([
      this.notificationModel
        .find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean()
        .exec(),
      this.notificationModel.countDocuments(filter).exec(),
    ]);
    return {
      data: (rows as Notification[]).map(toAdminNotification),
      meta: {
        page,
        limit,
        total,
        pages: Math.max(1, Math.ceil(total / limit)),
      },
    };
  }

  getAdminById(notificationId: string): Promise<NotificationDocument> {
    return this.getById(notificationId);
  }

  async unreadCount(userId: string): Promise<{ unread: number }> {
    const user = this.toObjectId(userId, 'usuario');
    const unread = await this.notificationModel
      .countDocuments({
        user,
        readAt: { $exists: false },
        $or: [
          { expiresAt: { $exists: false } },
          { expiresAt: { $gt: new Date() } },
        ],
      })
      .exec();
    return { unread };
  }

  async markRead(
    notificationId: string,
    userId: string,
  ): Promise<PublicNotificationView> {
    const _id = this.toObjectId(notificationId, 'notificación');
    const user = this.toObjectId(userId, 'usuario');
    const notification = await this.notificationModel
      .findOneAndUpdate(
        { _id, user },
        { $set: { readAt: new Date() } },
        { new: true },
      )
      .exec();

    if (!notification) {
      throw new NotFoundException('Notificación no encontrada para el usuario');
    }
    return toPublicNotification(notification);
  }

  async markAllRead(userId: string): Promise<{ modified: number }> {
    const user = this.toObjectId(userId, 'usuario');
    const result = await this.notificationModel
      .updateMany(
        { user, readAt: { $exists: false } },
        { $set: { readAt: new Date() } },
      )
      .exec();
    return { modified: result.modifiedCount };
  }

  async registerSubscription(
    userId: string,
    dto: RegisterPushSubscriptionDto,
  ): Promise<PushSubscriptionView> {
    const user = this.toObjectId(userId, 'usuario');
    this.assertProviderSupports(dto.provider);
    const originalAddress = dto.address.trim();
    let address = originalAddress;
    let credentials = this.sanitizeCredentials(dto.credentials);

    if (dto.expiresAt && new Date(dto.expiresAt).getTime() <= Date.now()) {
      throw new BadRequestException('La suscripción push ya está expirada');
    }
    if (dto.provider === PushProviderKind.WebPush) {
      try {
        const candidate = {
          provider: dto.provider,
          address,
          credentials,
        };
        const validated = this.pushProvider?.validateSubscription
          ? this.pushProvider.validateSubscription(candidate)
          : (() => {
              const subscription = validateWebPushSubscription(candidate);
              return {
                ...candidate,
                address: subscription.endpoint,
                credentials: subscription.keys,
              };
            })();
        address = validated.address;
        credentials = validated.credentials;
      } catch (error) {
        if (error instanceof InvalidWebPushSubscriptionError) {
          throw new BadRequestException(error.message);
        }
        throw new BadRequestException('Suscripción Web Push inválida');
      }
    }

    let owner = await this.findSubscriptionOwner(
      dto.provider,
      originalAddress,
      address,
    );
    if (owner && owner.user.toString() !== user.toString()) {
      throw new ConflictException(
        'La suscripción push ya pertenece a otro usuario',
      );
    }

    const maxSubscriptions = readWebPushMaxSubscriptionsPerUser(this.config);
    await this.normalizeSubscriptionCapacity(user, maxSubscriptions);
    const candidateSlots = Array.from(
      { length: maxSubscriptions },
      (_, slot) => slot,
    );
    if (
      owner?.enabled &&
      Number.isInteger(owner.activeSlot) &&
      owner.activeSlot! >= 0 &&
      owner.activeSlot! < maxSubscriptions
    ) {
      candidateSlots.splice(candidateSlots.indexOf(owner.activeSlot!), 1);
      candidateSlots.unshift(owner.activeSlot!);
    }

    let subscription: PushSubscriptionDocument | null = null;
    for (const activeSlot of candidateSlots) {
      try {
        subscription = await this.subscriptionModel
          .findOneAndUpdate(
            owner?._id
              ? { _id: owner._id, user }
              : { provider: dto.provider, address, user },
            {
              $set: {
                user,
                provider: dto.provider,
                address,
                credentials,
                deviceId: dto.deviceId,
                locale: dto.locale,
                timezone: dto.timezone,
                expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : undefined,
                enabled: true,
                activeSlot,
                lastSeenAt: new Date(),
              },
              $unset: { disabledAt: '', disableReason: '' },
            },
            {
              new: true,
              upsert: !owner,
              setDefaultsOnInsert: true,
            },
          )
          .exec();
        if (subscription) break;
        owner = null;
      } catch (error) {
        if (!this.isDuplicateKey(error)) throw error;

        const concurrentOwner = await this.findSubscriptionOwner(
          dto.provider,
          originalAddress,
          address,
        );
        if (
          concurrentOwner &&
          concurrentOwner.user.toString() !== user.toString()
        ) {
          throw new ConflictException(
            'La suscripción push ya pertenece a otro usuario',
          );
        }
        owner = concurrentOwner;
      }
    }

    if (!subscription) {
      throw new ConflictException(
        `El usuario alcanzó el máximo de ${maxSubscriptions} suscripciones push activas`,
      );
    }

    await this.preferenceModel
      .findOneAndUpdate(
        { user },
        { $set: { pushEnabled: true }, $setOnInsert: { user } },
        { upsert: true, setDefaultsOnInsert: true },
      )
      .exec();

    return toPushSubscription(subscription);
  }

  async unregisterSubscription(
    subscriptionId: string,
    userId: string,
  ): Promise<{ disabled: boolean }> {
    const _id = this.toObjectId(subscriptionId, 'suscripción');
    const user = this.toObjectId(userId, 'usuario');
    const result = await this.subscriptionModel
      .updateOne(
        { _id, user },
        {
          $set: {
            enabled: false,
            disabledAt: new Date(),
            disableReason: PushSubscriptionDisableReason.UserUnregistered,
          },
          $unset: { activeSlot: '' },
        },
      )
      .exec();
    if (result.matchedCount === 0) {
      throw new NotFoundException('Suscripción push no encontrada');
    }
    return { disabled: result.modifiedCount > 0 };
  }

  async getPreferences(userId: string): Promise<NotificationPreferenceView> {
    const preferences = await this.getPreferenceDocument(userId);
    return toNotificationPreference(preferences);
  }

  private async getPreferenceDocument(
    userId: string,
  ): Promise<NotificationPreferenceDocument> {
    const user = this.toObjectId(userId, 'usuario');
    return this.preferenceModel
      .findOneAndUpdate(
        { user },
        { $setOnInsert: { user } },
        { new: true, upsert: true, setDefaultsOnInsert: true },
      )
      .exec();
  }

  async updatePreferences(
    userId: string,
    dto: UpdateNotificationPreferencesDto,
  ): Promise<NotificationPreferenceView> {
    const user = this.toObjectId(userId, 'usuario');
    const preferences = await this.preferenceModel
      .findOneAndUpdate(
        { user },
        { $set: dto, $setOnInsert: { user } },
        { new: true, upsert: true, setDefaultsOnInsert: true },
      )
      .exec();
    return toNotificationPreference(preferences);
  }

  @Cron('*/30 * * * * *')
  async processPendingPushDeliveries(): Promise<number> {
    const now = new Date();
    const candidates = await this.notificationModel
      .find({
        pushRequested: true,
        $or: [
          {
            deliveryStatus: NotificationDeliveryStatus.Pending,
            $or: [
              { scheduledAt: { $exists: false } },
              { scheduledAt: { $lte: now } },
            ],
          },
          {
            deliveryStatus: NotificationDeliveryStatus.Processing,
            $or: [
              { deliveryLeaseExpiresAt: { $exists: false } },
              { deliveryLeaseExpiresAt: { $lte: now } },
            ],
          },
        ],
      })
      .sort({ scheduledAt: 1, createdAt: 1 })
      .limit(DELIVERY_WORKER_BATCH_SIZE)
      .select('_id deliveryStatus deliveryDispatchStartedAt')
      .lean()
      .exec();

    for (
      let cursor = 0;
      cursor < candidates.length;
      cursor += DELIVERY_WORKER_CONCURRENCY
    ) {
      const batch = candidates.slice(
        cursor,
        cursor + DELIVERY_WORKER_CONCURRENCY,
      );
      await Promise.allSettled(
        batch.map((candidate) =>
          candidate.deliveryStatus === NotificationDeliveryStatus.Processing &&
          candidate.deliveryDispatchStartedAt
            ? this.finalizeUncertainDelivery(candidate._id.toString())
            : this.deliverPushInternal(candidate._id.toString(), true),
        ),
      );
    }
    return candidates.length;
  }

  async deliverPush(notificationId: string): Promise<NotificationDocument> {
    return this.deliverPushInternal(notificationId, false);
  }

  private async deliverPushInternal(
    notificationId: string,
    automatic: boolean,
  ): Promise<NotificationDocument> {
    const uncertain = await this.finalizeUncertainDelivery(notificationId);
    if (uncertain) return uncertain;
    const claim = await this.claimDelivery(notificationId, automatic);
    if (!claim) return this.getById(notificationId);
    const { notification, leaseToken } = claim;
    const preferences = await this.getPreferenceDocument(
      notification.user.toString(),
    );

    if (!this.pushProvider || this.pushProvider.isConfigured === false) {
      return this.setDeliveryState(
        notification,
        leaseToken,
        NotificationDeliveryStatus.Skipped,
        'No hay proveedor push configurado',
        false,
        {
          provider: this.pushProvider?.providerName ?? 'none',
          code: NotificationDeliveryCode.NotConfigured,
        },
      );
    }
    if (!canDeliverPushIgnoringQuietHours(preferences, notification.type)) {
      return this.setDeliveryState(
        notification,
        leaseToken,
        NotificationDeliveryStatus.Skipped,
        'Las preferencias del usuario impiden la entrega push',
        false,
        {
          provider: this.pushProvider.providerName,
          code: NotificationDeliveryCode.PreferencesBlocked,
        },
      );
    }

    const deliveryNow = new Date();
    if (isInsideQuietHours(preferences, deliveryNow)) {
      return this.setDeliveryState(
        notification,
        leaseToken,
        NotificationDeliveryStatus.Pending,
        'Entrega pospuesta por las horas silenciosas del usuario',
        false,
        {
          provider: this.pushProvider.providerName,
          code: NotificationDeliveryCode.QuietHours,
        },
        {
          pushRequested: true,
          scheduledAt: nextAllowedPushAt(preferences, deliveryNow),
        },
      );
    }

    await this.subscriptionModel
      .updateMany(
        {
          user: notification.user,
          enabled: true,
          expiresAt: { $lte: deliveryNow },
        },
        {
          $set: {
            enabled: false,
            disabledAt: deliveryNow,
            disableReason: PushSubscriptionDisableReason.Expired,
          },
          $unset: { activeSlot: '' },
        },
      )
      .exec();

    const providerFilter =
      this.pushProvider.providerName === 'web-push'
        ? { provider: PushProviderKind.WebPush }
        : {};
    const maxSubscriptions = readWebPushMaxSubscriptionsPerUser(this.config);
    const subscriptions = await this.subscriptionModel
      .find({
        user: notification.user,
        enabled: true,
        ...providerFilter,
        $or: [
          { expiresAt: { $exists: false } },
          { expiresAt: { $gt: new Date() } },
        ],
      })
      .sort({ lastSeenAt: -1, _id: -1 })
      .limit(maxSubscriptions)
      .lean()
      .exec();

    if (subscriptions.length === 0) {
      return this.setDeliveryState(
        notification,
        leaseToken,
        NotificationDeliveryStatus.Skipped,
        'El usuario no tiene suscripciones push activas',
        false,
        {
          provider: this.pushProvider.providerName,
          code: NotificationDeliveryCode.NoSubscriptions,
        },
      );
    }

    const attempted = await this.notificationModel
      .findOneAndUpdate(
        {
          _id: notification._id,
          deliveryStatus: NotificationDeliveryStatus.Processing,
          deliveryLeaseToken: leaseToken,
        },
        {
          $inc: { deliveryAttempts: 1 },
          $set: {
            lastDeliveryAttemptAt: deliveryNow,
            deliveryDispatchStartedAt: deliveryNow,
          },
        },
        { new: true },
      )
      .exec();
    if (!attempted) return this.getById(notificationId);

    let result: PushDeliveryResult;
    try {
      result = await this.withLeaseHeartbeat(attempted, leaseToken, () =>
        this.pushProvider!.send(
          {
            notificationId: attempted.id,
            title: attempted.title,
            body: attempted.body,
            type: attempted.type,
            data: attempted.data ?? {},
            imageUrl: attempted.imageUrl,
            actionUrl: attempted.actionUrl,
          },
          subscriptions.map((subscription) => ({
            subscriptionId: subscription._id.toString(),
            provider: subscription.provider,
            address: subscription.address,
            credentials: subscription.credentials ?? {},
          })),
        ),
      );
    } catch {
      // El contrato del proveedor convierte fallos conocidos de cada destino
      // en PushDeliveryResult. Si el adaptador lanza después de comenzar el
      // dispatch, algunos servicios externos podrían haber aceptado el push;
      // reintentarlo automáticamente duplicaría notificaciones.
      return this.setDeliveryState(
        attempted,
        leaseToken,
        NotificationDeliveryStatus.Failed,
        'El proveedor terminó sin confirmar el resultado; revise antes de reintentar',
        false,
        {
          provider: this.pushProvider.providerName,
          code: NotificationDeliveryCode.DeliveryUncertain,
        },
      );
    }

    // La limpieza local jamás puede convertir un push ya aceptado en reenvío.
    await this.disableRejectedSubscriptions(attempted, result).catch(
      () => undefined,
    );

    const details = {
      provider: result.provider,
      code: result.errorCode,
      accepted: result.accepted,
      rejected: result.rejected,
      invalidSubscriptions:
        (result.invalidSubscriptionIds?.length ?? 0) +
        (result.expiredSubscriptionIds?.length ?? 0),
    };

    if (result.accepted === 0 && this.isTransientFailure(result)) {
      return this.scheduleRetry(
        attempted,
        leaseToken,
        result.error ?? 'Fallo transitorio del proveedor push',
        details,
      );
    }

    const status =
      result.accepted > 0 && result.rejected > 0
        ? NotificationDeliveryStatus.PartiallySent
        : result.accepted > 0
          ? NotificationDeliveryStatus.Sent
          : NotificationDeliveryStatus.Failed;
    return this.setDeliveryState(
      attempted,
      leaseToken,
      status,
      result.error,
      result.accepted > 0,
      {
        ...details,
        code:
          result.errorCode ??
          (status === NotificationDeliveryStatus.Sent
            ? NotificationDeliveryCode.Delivered
            : status === NotificationDeliveryStatus.PartiallySent
              ? NotificationDeliveryCode.PartialFailure
              : NotificationDeliveryCode.DeliveryFailed),
      },
    );
  }

  private async claimDelivery(
    notificationId: string,
    automatic: boolean,
  ): Promise<
    { notification: NotificationDocument; leaseToken: string } | undefined
  > {
    const _id = this.toObjectId(notificationId, 'notificación');
    const now = new Date();
    const leaseToken = randomUUID();
    const pendingDue = {
      deliveryStatus: NotificationDeliveryStatus.Pending,
      $or: [
        { scheduledAt: { $exists: false } },
        { scheduledAt: { $lte: now } },
      ],
    };
    const staleLease = {
      deliveryStatus: NotificationDeliveryStatus.Processing,
      deliveryDispatchStartedAt: { $exists: false },
      $or: [
        { deliveryLeaseExpiresAt: { $exists: false } },
        { deliveryLeaseExpiresAt: { $lte: now } },
      ],
    };
    const eligibleStates = automatic
      ? [pendingDue, staleLease]
      : [
          pendingDue,
          staleLease,
          { deliveryStatus: NotificationDeliveryStatus.Failed },
          { deliveryStatus: NotificationDeliveryStatus.Skipped },
        ];
    const filter: FilterQuery<NotificationDocument> = {
      _id,
      ...(automatic ? { pushRequested: true } : {}),
      $or: eligibleStates,
    };

    const notification = await this.notificationModel
      .findOneAndUpdate(
        filter,
        {
          $set: {
            deliveryStatus: NotificationDeliveryStatus.Processing,
            pushRequested: true,
            deliveryLeaseToken: leaseToken,
            deliveryLeaseExpiresAt: new Date(
              now.getTime() + DELIVERY_LEASE_MILLISECONDS,
            ),
          },
          $unset: { scheduledAt: 1 },
        },
        { new: true },
      )
      .exec();
    return notification ? { notification, leaseToken } : undefined;
  }

  private async getById(notificationId: string): Promise<NotificationDocument> {
    const _id = this.toObjectId(notificationId, 'notificación');
    const notification = await this.notificationModel.findById(_id).exec();
    if (!notification)
      throw new NotFoundException('Notificación no encontrada');
    return notification;
  }

  private findByEventKey(
    user: Types.ObjectId,
    eventKey: string,
  ): Promise<NotificationDocument | null> {
    return this.notificationModel.findOne({ user, eventKey }).exec();
  }

  private async setDeliveryState(
    notification: NotificationDocument,
    leaseToken: string,
    status: NotificationDeliveryStatus,
    error?: string,
    delivered = false,
    details: DeliveryStateDetails = {},
    options: DeliveryStateOptions = {},
  ): Promise<NotificationDocument> {
    const set: Record<string, unknown> = {
      deliveryStatus: status,
      pushRequested: options.pushRequested ?? false,
      deliveryAccepted: details.accepted ?? 0,
      deliveryRejected: details.rejected ?? 0,
      deliveryInvalidSubscriptions: details.invalidSubscriptions ?? 0,
    };
    const unset: Record<string, 1> = {
      deliveryLeaseToken: 1,
      deliveryLeaseExpiresAt: 1,
      deliveryDispatchStartedAt: 1,
    };
    if (error) set.lastDeliveryError = error.slice(0, 500);
    else unset.lastDeliveryError = 1;
    if (details.provider) set.deliveryProvider = details.provider;
    else unset.deliveryProvider = 1;
    if (details.code) set.deliveryCode = details.code;
    else unset.deliveryCode = 1;
    if (options.scheduledAt) set.scheduledAt = options.scheduledAt;
    else unset.scheduledAt = 1;
    if (delivered) set.deliveredAt = new Date();

    const updated = await this.notificationModel
      .findOneAndUpdate(
        {
          _id: notification._id,
          deliveryStatus: NotificationDeliveryStatus.Processing,
          deliveryLeaseToken: leaseToken,
        },
        { $set: set, $unset: unset },
        { new: true },
      )
      .exec();
    return updated ?? this.getById(notification.id);
  }

  private async scheduleRetry(
    notification: NotificationDocument,
    leaseToken: string,
    error: string,
    details: DeliveryStateDetails,
  ): Promise<NotificationDocument> {
    const attempts = notification.deliveryAttempts ?? 0;
    if (attempts >= MAX_AUTOMATIC_DELIVERY_ATTEMPTS) {
      return this.setDeliveryState(
        notification,
        leaseToken,
        NotificationDeliveryStatus.Failed,
        error,
        false,
        { ...details, code: NotificationDeliveryCode.AttemptsExhausted },
      );
    }

    const exponent = Math.max(0, attempts - 1);
    const delay = Math.min(
      RETRY_MAX_MILLISECONDS,
      RETRY_BASE_MILLISECONDS * 2 ** exponent,
    );
    return this.setDeliveryState(
      notification,
      leaseToken,
      NotificationDeliveryStatus.Pending,
      error,
      false,
      { ...details, code: NotificationDeliveryCode.RetryScheduled },
      {
        pushRequested: true,
        scheduledAt: new Date(Date.now() + delay),
      },
    );
  }

  private isTransientFailure(result: PushDeliveryResult): boolean {
    if (result.accepted > 0) return false;
    const invalidTargets =
      (result.invalidSubscriptionIds?.length ?? 0) +
      (result.expiredSubscriptionIds?.length ?? 0);
    if (result.rejected > 0 && invalidTargets >= result.rejected) return false;
    if (!result.errorCode) return true;
    return new Set([
      'rate_limited',
      'upstream_unavailable',
      'network_error',
      'delivery_failed',
      'validation_failed',
    ]).has(result.errorCode);
  }

  private async withLeaseHeartbeat<T>(
    notification: NotificationDocument,
    leaseToken: string,
    operation: () => Promise<T>,
  ): Promise<T> {
    const heartbeat = setInterval(() => {
      void this.notificationModel
        .updateOne(
          {
            _id: notification._id,
            deliveryStatus: NotificationDeliveryStatus.Processing,
            deliveryLeaseToken: leaseToken,
          },
          {
            $set: {
              deliveryLeaseExpiresAt: new Date(
                Date.now() + DELIVERY_LEASE_MILLISECONDS,
              ),
            },
          },
        )
        .exec()
        .catch(() => undefined);
    }, DELIVERY_LEASE_HEARTBEAT_MILLISECONDS);
    heartbeat.unref();
    try {
      return await operation();
    } finally {
      clearInterval(heartbeat);
    }
  }

  private async finalizeUncertainDelivery(
    notificationId: string,
  ): Promise<NotificationDocument | undefined> {
    const _id = this.toObjectId(notificationId, 'notificación');
    const updated = await this.notificationModel
      .findOneAndUpdate(
        {
          _id,
          deliveryStatus: NotificationDeliveryStatus.Processing,
          deliveryDispatchStartedAt: { $exists: true },
          $or: [
            { deliveryLeaseExpiresAt: { $exists: false } },
            { deliveryLeaseExpiresAt: { $lte: new Date() } },
          ],
        },
        {
          $set: {
            deliveryStatus: NotificationDeliveryStatus.Failed,
            pushRequested: false,
            deliveryCode: NotificationDeliveryCode.DeliveryUncertain,
            lastDeliveryError:
              'El proceso terminó durante el envío; se requiere revisión manual antes de reintentar',
          },
          $unset: {
            scheduledAt: 1,
            deliveryLeaseToken: 1,
            deliveryLeaseExpiresAt: 1,
            deliveryDispatchStartedAt: 1,
          },
        },
        { new: true },
      )
      .exec();
    return updated ?? undefined;
  }

  private async disableRejectedSubscriptions(
    notification: NotificationDocument,
    result: PushDeliveryResult,
  ): Promise<void> {
    const now = new Date();
    const expiredIds = this.validObjectIds(result.expiredSubscriptionIds);
    const invalidIds = this.validObjectIds(
      result.invalidSubscriptionIds,
    ).filter((id) => !expiredIds.some((expired) => expired.equals(id)));
    const updates: Promise<unknown>[] = [];
    if (expiredIds.length) {
      updates.push(
        this.subscriptionModel
          .updateMany(
            { _id: { $in: expiredIds }, user: notification.user },
            {
              $set: {
                enabled: false,
                disabledAt: now,
                disableReason: PushSubscriptionDisableReason.Expired,
              },
              $unset: { activeSlot: '' },
            },
          )
          .exec(),
      );
    }
    if (invalidIds.length) {
      updates.push(
        this.subscriptionModel
          .updateMany(
            { _id: { $in: invalidIds }, user: notification.user },
            {
              $set: {
                enabled: false,
                disabledAt: now,
                disableReason: PushSubscriptionDisableReason.Invalid,
              },
              $unset: { activeSlot: '' },
            },
          )
          .exec(),
      );
    }
    await Promise.all(updates);
  }

  private validObjectIds(values?: string[]): Types.ObjectId[] {
    return [
      ...new Set(
        (values ?? []).filter((value) => Types.ObjectId.isValid(value)),
      ),
    ].map((value) => new Types.ObjectId(value));
  }

  private toObjectId(value: string, label: string): Types.ObjectId {
    if (!Types.ObjectId.isValid(value)) {
      throw new BadRequestException(`ID de ${label} inválido`);
    }
    return new Types.ObjectId(value);
  }

  private boundedInteger(
    value: string | undefined,
    fallback: number,
    min: number,
    max: number,
  ): number {
    if (value === undefined) return fallback;
    const parsed = Number(value);
    if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) {
      throw new BadRequestException(`Valor numérico fuera de rango: ${value}`);
    }
    return parsed;
  }

  private sanitizeCredentials(
    credentials?: Record<string, string>,
  ): Record<string, string> {
    if (!credentials) return {};
    const entries = Object.entries(credentials);
    if (entries.length > 10) {
      throw new BadRequestException('Demasiadas credenciales push');
    }
    const sanitized: Record<string, string> = {};
    for (const [key, value] of entries) {
      if (
        !/^[A-Za-z0-9_-]{1,64}$/.test(key) ||
        typeof value !== 'string' ||
        value.length > 4096
      ) {
        throw new BadRequestException('Credenciales push inválidas');
      }
      sanitized[key] = value;
    }
    return sanitized;
  }

  private assertProviderSupports(provider: PushProviderKind): void {
    if (!this.pushProvider || this.pushProvider.isConfigured === false) {
      throw new ServiceUnavailableException(
        'El registro push no está disponible porque el proveedor está desactivado',
      );
    }
    if (
      this.pushProvider.providerName === 'web-push' &&
      provider !== PushProviderKind.WebPush
    ) {
      throw new BadRequestException(
        'El proveedor configurado solo admite suscripciones web_push',
      );
    }
  }

  private findSubscriptionOwner(
    provider: PushProviderKind,
    originalAddress: string,
    normalizedAddress: string,
  ) {
    return this.subscriptionModel
      .findOne({
        provider,
        address: {
          $in: [...new Set([originalAddress, normalizedAddress])],
        },
      })
      .select('user address enabled activeSlot')
      .lean()
      .exec();
  }

  private async normalizeSubscriptionCapacity(
    user: Types.ObjectId,
    maxSubscriptions: number,
  ): Promise<void> {
    const now = new Date();
    await this.subscriptionModel
      .updateMany(
        {
          user,
          enabled: true,
          $or: [
            { activeSlot: null },
            { activeSlot: { $gte: maxSubscriptions } },
          ],
        },
        {
          $set: {
            enabled: false,
            disabledAt: now,
            disableReason: PushSubscriptionDisableReason.CapacityExceeded,
          },
          $unset: { activeSlot: '' },
        },
      )
      .exec();
  }

  private isDuplicateKey(error: unknown): boolean {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      (error as { code?: number }).code === 11000
    );
  }
}
