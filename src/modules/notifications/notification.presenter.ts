import { Types } from 'mongoose';
import {
  Notification,
  NotificationDeliveryStatus,
  NotificationType,
} from './schemas/notification.schema';
import { NotificationPreference } from './schemas/notification-preference.schema';
import {
  PushProviderKind,
  PushSubscription,
} from './schemas/push-subscription.schema';

type WithDocumentId<T> = T & {
  _id?: Types.ObjectId | string;
  id?: string;
};

export interface PublicNotificationView {
  id: string;
  title: string;
  body: string;
  type: NotificationType;
  data: Record<string, unknown>;
  imageUrl?: string;
  actionUrl?: string;
  readAt?: Date;
  expiresAt?: Date;
  createdAt: Date;
}

export interface AdminNotificationView extends PublicNotificationView {
  userId: string;
  deliveryStatus: NotificationDeliveryStatus;
  deliveryAttempts: number;
  deliveryProvider?: string;
  deliveryCode?: string;
  deliveryAccepted: number;
  deliveryRejected: number;
  deliveryInvalidSubscriptions: number;
  deliveredAt?: Date;
  lastDeliveryError?: string;
  createdBy?: string;
  updatedAt: Date;
}

export interface PushSubscriptionView {
  id: string;
  provider: PushProviderKind;
  deviceId?: string;
  locale?: string;
  timezone?: string;
  enabled: boolean;
  lastSeenAt: Date;
  expiresAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface NotificationPreferenceView {
  inAppEnabled: boolean;
  pushEnabled: boolean;
  transactionalEnabled: boolean;
  marketingEnabled: boolean;
  mutedTypes: NotificationType[];
  quietHoursStart?: string;
  quietHoursEnd?: string;
  timezoneOffsetMinutes: number;
}

function documentId(value: { _id?: Types.ObjectId | string; id?: string }) {
  return value.id ?? value._id?.toString() ?? '';
}

export function toPublicNotification(
  notification: WithDocumentId<Notification>,
): PublicNotificationView {
  return {
    id: documentId(notification),
    title: notification.title,
    body: notification.body,
    type: notification.type,
    data: notification.data ?? {},
    imageUrl: notification.imageUrl,
    actionUrl: notification.actionUrl,
    readAt: notification.readAt,
    expiresAt: notification.expiresAt,
    createdAt: notification.createdAt,
  };
}

export function toAdminNotification(
  notification: WithDocumentId<Notification>,
): AdminNotificationView {
  return {
    ...toPublicNotification(notification),
    userId: notification.user.toString(),
    deliveryStatus: notification.deliveryStatus,
    deliveryAttempts: notification.deliveryAttempts,
    deliveryProvider: notification.deliveryProvider,
    deliveryCode: notification.deliveryCode,
    deliveryAccepted: notification.deliveryAccepted ?? 0,
    deliveryRejected: notification.deliveryRejected ?? 0,
    deliveryInvalidSubscriptions:
      notification.deliveryInvalidSubscriptions ?? 0,
    deliveredAt: notification.deliveredAt,
    lastDeliveryError: notification.lastDeliveryError,
    createdBy: notification.createdBy,
    updatedAt: notification.updatedAt,
  };
}

export function toPushSubscription(
  subscription: WithDocumentId<PushSubscription>,
): PushSubscriptionView {
  return {
    id: documentId(subscription),
    provider: subscription.provider,
    deviceId: subscription.deviceId,
    locale: subscription.locale,
    timezone: subscription.timezone,
    enabled: subscription.enabled,
    lastSeenAt: subscription.lastSeenAt,
    expiresAt: subscription.expiresAt,
    createdAt: subscription.createdAt,
    updatedAt: subscription.updatedAt,
  };
}

export function toNotificationPreference(
  preferences: NotificationPreference,
): NotificationPreferenceView {
  return {
    inAppEnabled: preferences.inAppEnabled,
    pushEnabled: preferences.pushEnabled,
    transactionalEnabled: preferences.transactionalEnabled,
    marketingEnabled: preferences.marketingEnabled,
    mutedTypes: preferences.mutedTypes ?? [],
    quietHoursStart: preferences.quietHoursStart,
    quietHoursEnd: preferences.quietHoursEnd,
    timezoneOffsetMinutes: preferences.timezoneOffsetMinutes ?? 0,
  };
}
