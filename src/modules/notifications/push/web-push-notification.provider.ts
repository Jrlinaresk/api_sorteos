import * as webPush from 'web-push';
import { PushProviderKind } from '../schemas/push-subscription.schema';
import {
  NotificationPushProvider,
  PushDeliveryResult,
  PushDeliveryTarget,
  PushMessage,
  PushPublicConfiguration,
  PushSubscriptionCandidate,
} from './notification-push-provider';
import { WebPushConfiguration } from './web-push.config';
import {
  InvalidWebPushSubscriptionError,
  validateWebPushSubscription,
} from './web-push-subscription';

export interface WebPushClient {
  sendNotification(
    subscription: webPush.PushSubscription,
    payload: string,
    options: webPush.RequestOptions,
  ): Promise<webPush.SendResult>;
}

const defaultWebPushClient: WebPushClient = {
  sendNotification: (subscription, payload, options) =>
    webPush.sendNotification(subscription, payload, options),
};

interface TargetOutcome {
  accepted: boolean;
  subscriptionId: string;
  code?: string;
  expired?: boolean;
  invalid?: boolean;
}

export class WebPushNotificationProvider implements NotificationPushProvider {
  readonly providerName = 'web-push';
  readonly isConfigured = true;

  constructor(
    private readonly config: WebPushConfiguration,
    private readonly client: WebPushClient = defaultWebPushClient,
  ) {}

  getPublicConfiguration(): PushPublicConfiguration {
    return {
      enabled: true,
      provider: this.providerName,
      vapidPublicKey: this.config.publicKey,
    };
  }

  validateSubscription(
    candidate: PushSubscriptionCandidate,
  ): PushSubscriptionCandidate {
    const subscription = validateWebPushSubscription(
      candidate,
      this.config.allowedEndpointHosts,
    );
    return {
      ...candidate,
      address: subscription.endpoint,
      credentials: subscription.keys,
    };
  }

  async send(
    message: PushMessage,
    targets: PushDeliveryTarget[],
  ): Promise<PushDeliveryResult> {
    const payload = JSON.stringify({
      version: 1,
      notification: message,
    });
    if (Buffer.byteLength(payload, 'utf8') > this.config.maxPayloadBytes) {
      return {
        provider: this.providerName,
        accepted: 0,
        rejected: targets.length,
        errorCode: 'payload_too_large',
        error: 'El payload Web Push supera el límite configurado',
      };
    }

    const outcomes = await this.mapWithConcurrency(targets, (target) =>
      this.sendTarget(target, payload),
    );
    const accepted = outcomes.filter((outcome) => outcome.accepted).length;
    const rejected = outcomes.length - accepted;
    const codes = [
      ...new Set(
        outcomes
          .map((outcome) => outcome.code)
          .filter((code): code is string => Boolean(code)),
      ),
    ];
    return {
      provider: this.providerName,
      accepted,
      rejected,
      invalidSubscriptionIds: outcomes
        .filter((outcome) => outcome.invalid)
        .map((outcome) => outcome.subscriptionId),
      expiredSubscriptionIds: outcomes
        .filter((outcome) => outcome.expired)
        .map((outcome) => outcome.subscriptionId),
      errorCode:
        rejected === 0
          ? undefined
          : accepted > 0
            ? 'partial_failure'
            : codes.length === 1
              ? codes[0]
              : 'delivery_failed',
      error:
        rejected > 0
          ? `Web Push: ${accepted} entregadas y ${rejected} rechazadas (${codes.join(', ')})`
          : undefined,
    };
  }

  private async sendTarget(
    target: PushDeliveryTarget,
    payload: string,
  ): Promise<TargetOutcome> {
    if (target.provider !== PushProviderKind.WebPush) {
      return {
        accepted: false,
        subscriptionId: target.subscriptionId,
        code: 'unsupported_provider',
      };
    }

    let subscription: webPush.PushSubscription;
    try {
      subscription = validateWebPushSubscription(
        target,
        this.config.allowedEndpointHosts,
      );
    } catch (error) {
      if (error instanceof InvalidWebPushSubscriptionError) {
        return {
          accepted: false,
          subscriptionId: target.subscriptionId,
          code: 'invalid_subscription',
          invalid: true,
        };
      }
      return {
        accepted: false,
        subscriptionId: target.subscriptionId,
        code: 'validation_failed',
      };
    }

    try {
      await this.client.sendNotification(subscription, payload, {
        vapidDetails: {
          subject: this.config.subject,
          publicKey: this.config.publicKey,
          privateKey: this.config.privateKey,
        },
        TTL: this.config.ttlSeconds,
        timeout: this.config.timeoutMs,
        urgency: this.config.urgency,
        contentEncoding: 'aes128gcm',
      });
      return { accepted: true, subscriptionId: target.subscriptionId };
    } catch (error) {
      const statusCode = this.statusCode(error);
      if (statusCode === 404 || statusCode === 410) {
        return {
          accepted: false,
          subscriptionId: target.subscriptionId,
          code: 'subscription_expired',
          expired: true,
        };
      }
      return {
        accepted: false,
        subscriptionId: target.subscriptionId,
        code:
          statusCode === 401 || statusCode === 403
            ? 'authorization_failed'
            : statusCode === 429
              ? 'rate_limited'
              : statusCode && statusCode >= 500
                ? 'upstream_unavailable'
                : statusCode
                  ? 'upstream_rejected'
                  : 'network_error',
      };
    }
  }

  private async mapWithConcurrency(
    targets: PushDeliveryTarget[],
    operation: (target: PushDeliveryTarget) => Promise<TargetOutcome>,
  ): Promise<TargetOutcome[]> {
    const results = new Array<TargetOutcome>(targets.length);
    let cursor = 0;
    const worker = async () => {
      while (cursor < targets.length) {
        const index = cursor;
        cursor += 1;
        results[index] = await operation(targets[index]);
      }
    };
    const workers = Array.from(
      { length: Math.min(this.config.maxConcurrency, targets.length) },
      worker,
    );
    await Promise.all(workers);
    return results;
  }

  private statusCode(error: unknown): number | undefined {
    if (
      typeof error !== 'object' ||
      error === null ||
      !('statusCode' in error)
    ) {
      return undefined;
    }
    const value = (error as { statusCode?: unknown }).statusCode;
    return typeof value === 'number' ? value : undefined;
  }
}
