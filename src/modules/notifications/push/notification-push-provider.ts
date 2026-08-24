import { NotificationType } from '../schemas/notification.schema';
import { PushProviderKind } from '../schemas/push-subscription.schema';

export const NOTIFICATION_PUSH_PROVIDER = Symbol('NOTIFICATION_PUSH_PROVIDER');

export interface PushDeliveryTarget {
  subscriptionId: string;
  provider: PushProviderKind;
  address: string;
  credentials: Record<string, string>;
}

export interface PushMessage {
  notificationId: string;
  title: string;
  body: string;
  type: NotificationType;
  data: Record<string, unknown>;
  imageUrl?: string;
  actionUrl?: string;
}

export interface PushDeliveryResult {
  provider: string;
  accepted: number;
  rejected: number;
  skipped?: number;
  invalidSubscriptionIds?: string[];
  expiredSubscriptionIds?: string[];
  errorCode?: string;
  error?: string;
}

export interface PushPublicConfiguration {
  enabled: boolean;
  provider: string;
  vapidPublicKey?: string;
}

export interface PushSubscriptionCandidate {
  provider: PushProviderKind;
  address: string;
  credentials: Record<string, string>;
}

/**
 * Contrato deliberadamente independiente de Web Push, FCM o APNs.
 * El adaptador concreto se registra con NotificationsModule.register().
 */
export interface NotificationPushProvider {
  readonly providerName: string;
  /** false identifica el adaptador no-op y evita marcar una entrega como fallo. */
  readonly isConfigured?: boolean;

  validateSubscription?(
    candidate: PushSubscriptionCandidate,
  ): PushSubscriptionCandidate;
  getPublicConfiguration(): PushPublicConfiguration;

  send(
    message: PushMessage,
    targets: PushDeliveryTarget[],
  ): Promise<PushDeliveryResult>;
}
