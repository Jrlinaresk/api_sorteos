import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, Model, Types } from 'mongoose';
import { CreateNotificationDto } from './dto/create-notification.dto';
import { ListNotificationsQueryDto } from './dto/list-notifications-query.dto';
import { RegisterPushSubscriptionDto } from './dto/register-push-subscription.dto';
import { UpdateNotificationPreferencesDto } from './dto/update-notification-preferences.dto';
import { canDeliverPush } from './notification-policy';
import {
  NotificationPreferenceView,
  PublicNotificationView,
  PushSubscriptionView,
  toNotificationPreference,
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
    const { userId, deliverPush = false, expiresAt, ...content } = dto;
    const user = this.toObjectId(userId, 'usuario');

    const notification = await this.notificationModel.create({
      ...content,
      user,
      type: dto.type ?? NotificationType.General,
      createdBy: createdBy?.slice(0, 120),
      expiresAt: expiresAt ? new Date(expiresAt) : undefined,
    });

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

    const owner = await this.subscriptionModel
      .findOne({
        provider: dto.provider,
        address: { $in: [...new Set([originalAddress, address])] },
      })
      .select('user address')
      .lean()
      .exec();
    if (owner && owner.user.toString() !== user.toString()) {
      throw new ConflictException(
        'La suscripción push ya pertenece a otro usuario',
      );
    }

    let subscription: PushSubscriptionDocument;
    try {
      subscription = await this.subscriptionModel
        .findOneAndUpdate(
          owner?._id
            ? { _id: owner._id, user }
            : { provider: dto.provider, address, user },
          {
            $set: {
              user,
              address,
              credentials,
              deviceId: dto.deviceId,
              locale: dto.locale,
              timezone: dto.timezone,
              expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : undefined,
              enabled: true,
              lastSeenAt: new Date(),
            },
            $unset: { disabledAt: '', disableReason: '' },
          },
          { new: true, upsert: true, setDefaultsOnInsert: true },
        )
        .exec();
    } catch (error) {
      if (this.isDuplicateKey(error)) {
        throw new ConflictException(
          'La suscripción push ya pertenece a otro usuario',
        );
      }
      throw error;
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

  async deliverPush(notificationId: string): Promise<NotificationDocument> {
    const notification = await this.getById(notificationId);
    const preferences = await this.getPreferenceDocument(
      notification.user.toString(),
    );

    if (!this.pushProvider || this.pushProvider.isConfigured === false) {
      return this.setDeliveryState(
        notification,
        NotificationDeliveryStatus.Skipped,
        'No hay proveedor push configurado',
        false,
        {
          provider: this.pushProvider?.providerName ?? 'none',
          code: NotificationDeliveryCode.NotConfigured,
        },
      );
    }
    if (!canDeliverPush(preferences, notification.type)) {
      return this.setDeliveryState(
        notification,
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
        },
      )
      .exec();

    const subscriptions = await this.subscriptionModel
      .find({
        user: notification.user,
        enabled: true,
        $or: [
          { expiresAt: { $exists: false } },
          { expiresAt: { $gt: new Date() } },
        ],
      })
      .lean()
      .exec();

    if (subscriptions.length === 0) {
      return this.setDeliveryState(
        notification,
        NotificationDeliveryStatus.Skipped,
        'El usuario no tiene suscripciones push activas',
        false,
        {
          provider: this.pushProvider.providerName,
          code: NotificationDeliveryCode.NoSubscriptions,
        },
      );
    }

    notification.deliveryAttempts += 1;
    await notification.save();

    try {
      const result = await this.pushProvider.send(
        {
          notificationId: notification.id,
          title: notification.title,
          body: notification.body,
          type: notification.type,
          data: notification.data ?? {},
          imageUrl: notification.imageUrl,
          actionUrl: notification.actionUrl,
        },
        subscriptions.map((subscription) => ({
          subscriptionId: subscription._id.toString(),
          provider: subscription.provider,
          address: subscription.address,
          credentials: subscription.credentials ?? {},
        })),
      );

      await this.disableRejectedSubscriptions(notification, result);

      const status =
        result.accepted > 0 && result.rejected > 0
          ? NotificationDeliveryStatus.PartiallySent
          : result.accepted > 0
            ? NotificationDeliveryStatus.Sent
            : NotificationDeliveryStatus.Failed;
      return this.setDeliveryState(
        notification,
        status,
        result.error,
        result.accepted > 0,
        {
          provider: result.provider,
          code:
            result.errorCode ??
            (status === NotificationDeliveryStatus.Sent
              ? NotificationDeliveryCode.Delivered
              : status === NotificationDeliveryStatus.PartiallySent
                ? NotificationDeliveryCode.PartialFailure
                : NotificationDeliveryCode.DeliveryFailed),
          accepted: result.accepted,
          rejected: result.rejected,
          invalidSubscriptions:
            (result.invalidSubscriptionIds?.length ?? 0) +
            (result.expiredSubscriptionIds?.length ?? 0),
        },
      );
    } catch {
      return this.setDeliveryState(
        notification,
        NotificationDeliveryStatus.Failed,
        'Fallo inesperado del proveedor push',
        false,
        {
          provider: this.pushProvider.providerName,
          code: NotificationDeliveryCode.DeliveryFailed,
        },
      );
    }
  }

  private async getById(notificationId: string): Promise<NotificationDocument> {
    const _id = this.toObjectId(notificationId, 'notificación');
    const notification = await this.notificationModel.findById(_id).exec();
    if (!notification)
      throw new NotFoundException('Notificación no encontrada');
    return notification;
  }

  private async setDeliveryState(
    notification: NotificationDocument,
    status: NotificationDeliveryStatus,
    error?: string,
    delivered = false,
    details: DeliveryStateDetails = {},
  ): Promise<NotificationDocument> {
    notification.deliveryStatus = status;
    notification.lastDeliveryError = error?.slice(0, 500);
    notification.deliveryProvider = details.provider;
    notification.deliveryCode = details.code;
    notification.deliveryAccepted = details.accepted ?? 0;
    notification.deliveryRejected = details.rejected ?? 0;
    notification.deliveryInvalidSubscriptions =
      details.invalidSubscriptions ?? 0;
    if (delivered) notification.deliveredAt = new Date();
    return notification.save();
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

  private isDuplicateKey(error: unknown): boolean {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      (error as { code?: number }).code === 11000
    );
  }
}
