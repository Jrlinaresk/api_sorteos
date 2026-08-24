import { createECDH, randomBytes } from 'node:crypto';
import * as webPush from 'web-push';
import { NotificationType } from '../schemas/notification.schema';
import { PushProviderKind } from '../schemas/push-subscription.schema';
import { PushDeliveryTarget, PushMessage } from './notification-push-provider';
import {
  WebPushClient,
  WebPushNotificationProvider,
} from './web-push-notification.provider';
import { WebPushConfiguration } from './web-push.config';

describe('WebPushNotificationProvider', () => {
  const vapid = webPush.generateVAPIDKeys();
  const browserCurve = createECDH('prime256v1');
  browserCurve.generateKeys();
  const config: WebPushConfiguration = {
    subject: 'mailto:push@example.com',
    publicKey: vapid.publicKey,
    privateKey: vapid.privateKey,
    ttlSeconds: 300,
    timeoutMs: 10_000,
    urgency: 'normal',
    maxPayloadBytes: 3_500,
    maxConcurrency: 2,
    allowedEndpointHosts: ['fcm.googleapis.com'],
  };
  const message: PushMessage = {
    notificationId: 'notification-id',
    title: 'Pago confirmado',
    body: 'Tus títulos están disponibles',
    type: NotificationType.Payment,
    data: { orderId: 'order-id' },
  };
  const target: PushDeliveryTarget = {
    subscriptionId: 'subscription-id',
    provider: PushProviderKind.WebPush,
    address: 'https://fcm.googleapis.com/fcm/send/opaque-token',
    credentials: {
      p256dh: browserCurve.getPublicKey().toString('base64url'),
      auth: randomBytes(16).toString('base64url'),
    },
  };

  function providerWith(sendNotification: jest.Mock) {
    return new WebPushNotificationProvider(config, {
      sendNotification,
    } as WebPushClient);
  }

  it('sends an encrypted browser payload with per-request VAPID options', async () => {
    const sendNotification = jest.fn().mockResolvedValue({
      statusCode: 201,
      body: '',
      headers: {},
    });
    const provider = providerWith(sendNotification);

    const result = await provider.send(message, [target]);

    expect(result).toEqual({
      provider: 'web-push',
      accepted: 1,
      rejected: 0,
      invalidSubscriptionIds: [],
      expiredSubscriptionIds: [],
      errorCode: undefined,
      error: undefined,
    });
    const [, payload, options] = sendNotification.mock.calls[0];
    expect(JSON.parse(payload)).toEqual({ version: 1, notification: message });
    expect(options).toMatchObject({
      TTL: 300,
      timeout: 10_000,
      urgency: 'normal',
      contentEncoding: 'aes128gcm',
      vapidDetails: {
        subject: config.subject,
        publicKey: config.publicKey,
        privateKey: config.privateKey,
      },
    });
    expect(payload).not.toContain(config.privateKey);
  });

  it.each([404, 410])(
    'marks status %i as an expired endpoint without leaking upstream data',
    async (statusCode) => {
      const upstreamSecret = `${target.address}?private=${config.privateKey}`;
      const sendNotification = jest.fn().mockRejectedValue(
        Object.assign(new Error(upstreamSecret), {
          statusCode,
          body: upstreamSecret,
        }),
      );

      const result = await providerWith(sendNotification).send(message, [
        target,
      ]);

      expect(result.expiredSubscriptionIds).toEqual([target.subscriptionId]);
      expect(result.errorCode).toBe('subscription_expired');
      expect(JSON.stringify(result)).not.toContain(upstreamSecret);
      expect(JSON.stringify(result)).not.toContain(config.privateKey);
      expect(JSON.stringify(result)).not.toContain(target.address);
    },
  );

  it('disables malformed legacy subscriptions without making a request', async () => {
    const sendNotification = jest.fn();
    const result = await providerWith(sendNotification).send(message, [
      { ...target, credentials: { p256dh: 'bad', auth: 'bad' } },
    ]);

    expect(result).toMatchObject({
      accepted: 0,
      rejected: 1,
      errorCode: 'invalid_subscription',
      invalidSubscriptionIds: [target.subscriptionId],
    });
    expect(sendNotification).not.toHaveBeenCalled();
  });

  it('returns a safe partial result for mixed delivery', async () => {
    const sendNotification = jest
      .fn()
      .mockResolvedValueOnce({ statusCode: 201, body: '', headers: {} })
      .mockRejectedValueOnce({ statusCode: 410 });
    const second = {
      ...target,
      subscriptionId: 'expired-subscription',
      address: `${target.address}-second`,
    };

    const result = await providerWith(sendNotification).send(message, [
      target,
      second,
    ]);

    expect(result).toMatchObject({
      provider: 'web-push',
      accepted: 1,
      rejected: 1,
      errorCode: 'partial_failure',
      expiredSubscriptionIds: ['expired-subscription'],
    });
  });

  it('rejects oversized payloads before contacting a push service', async () => {
    const sendNotification = jest.fn();
    const provider = new WebPushNotificationProvider(
      { ...config, maxPayloadBytes: 512 },
      { sendNotification } as WebPushClient,
    );
    const result = await provider.send(
      { ...message, body: 'x'.repeat(1_000) },
      [target],
    );
    expect(result.errorCode).toBe('payload_too_large');
    expect(sendNotification).not.toHaveBeenCalled();
  });
});
