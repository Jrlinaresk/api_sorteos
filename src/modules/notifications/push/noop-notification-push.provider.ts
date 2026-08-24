import { Injectable } from '@nestjs/common';
import {
  NotificationPushProvider,
  PushDeliveryResult,
  PushDeliveryTarget,
  PushMessage,
  PushPublicConfiguration,
  PushSubscriptionCandidate,
} from './notification-push-provider';
import { DEFAULT_WEB_PUSH_ENDPOINT_HOSTS } from './web-push.config';
import { validateWebPushSubscription } from './web-push-subscription';

/**
 * Adaptador predeterminado: persiste el inbox pero nunca contacta un proveedor
 * externo ni consume un servicio de pago.
 */
@Injectable()
export class NoopNotificationPushProvider implements NotificationPushProvider {
  readonly providerName = 'noop';
  readonly isConfigured = false;

  constructor(
    private readonly allowedEndpointHosts: readonly string[] = DEFAULT_WEB_PUSH_ENDPOINT_HOSTS,
  ) {}

  getPublicConfiguration(): PushPublicConfiguration {
    return { enabled: false, provider: this.providerName };
  }

  validateSubscription(
    candidate: PushSubscriptionCandidate,
  ): PushSubscriptionCandidate {
    if (candidate.provider === 'web_push') {
      const subscription = validateWebPushSubscription(
        candidate,
        this.allowedEndpointHosts,
      );
      return {
        ...candidate,
        address: subscription.endpoint,
        credentials: subscription.keys,
      };
    }
    return candidate;
  }

  async send(
    _message: PushMessage,
    targets: PushDeliveryTarget[],
  ): Promise<PushDeliveryResult> {
    return {
      provider: this.providerName,
      accepted: 0,
      rejected: targets.length,
      skipped: targets.length,
      errorCode: 'not_configured',
      error: 'No hay proveedor push configurado',
    };
  }
}
