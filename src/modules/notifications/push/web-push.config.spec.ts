import { ConfigService } from '@nestjs/config';
import * as webPush from 'web-push';
import { createConfiguredNotificationPushProvider } from './configured-notification-push.provider';
import { NoopNotificationPushProvider } from './noop-notification-push.provider';
import { WebPushNotificationProvider } from './web-push-notification.provider';
import { readWebPushConfiguration } from './web-push.config';

describe('Web Push configuration', () => {
  const firstKeys = webPush.generateVAPIDKeys();
  const secondKeys = webPush.generateVAPIDKeys();

  function configured(values: Record<string, unknown> = {}) {
    return new ConfigService(values);
  }

  it('selects and clearly marks no-op by default', async () => {
    const config = configured();
    expect(readWebPushConfiguration(config)).toBeNull();
    const provider = createConfiguredNotificationPushProvider(config);
    expect(provider).toBeInstanceOf(NoopNotificationPushProvider);
    await expect(
      provider.send(
        {
          notificationId: 'id',
          title: 'Título',
          body: 'Cuerpo',
          type: 'general' as never,
          data: {},
        },
        [
          {
            subscriptionId: 'subscription-id',
            provider: 'custom' as never,
            address: 'opaque',
            credentials: {},
          },
        ],
      ),
    ).resolves.toEqual({
      provider: 'noop',
      accepted: 0,
      rejected: 1,
      skipped: 1,
      errorCode: 'not_configured',
      error: 'No hay proveedor push configurado',
    });
  });

  it('keeps no-op explicitly selected even when a complete VAPID pair exists', () => {
    const provider = createConfiguredNotificationPushProvider(
      configured({
        NOTIFICATION_PUSH_PROVIDER: 'noop',
        WEB_PUSH_VAPID_SUBJECT: 'mailto:push@example.com',
        WEB_PUSH_VAPID_PUBLIC_KEY: firstKeys.publicKey,
        WEB_PUSH_VAPID_PRIVATE_KEY: firstKeys.privateKey,
      }),
    );
    expect(provider).toBeInstanceOf(NoopNotificationPushProvider);
    expect(provider.getPublicConfiguration()).toEqual({
      enabled: false,
      provider: 'noop',
    });
  });

  it('does not parse Web Push-only settings while no-op is selected', () => {
    expect(() =>
      createConfiguredNotificationPushProvider(
        configured({
          NOTIFICATION_PUSH_PROVIDER: 'noop',
          WEB_PUSH_ALLOWED_ENDPOINT_HOSTS: '*',
          WEB_PUSH_VAPID_PRIVATE_KEY: 'incomplete-but-disabled',
        }),
      ),
    ).not.toThrow();
  });

  it('requires complete VAPID configuration when webpush is selected', () => {
    expect(() =>
      createConfiguredNotificationPushProvider(
        configured({ NOTIFICATION_PUSH_PROVIDER: 'webpush' }),
      ),
    ).toThrow('NOTIFICATION_PUSH_PROVIDER=webpush requiere');
  });

  it('rejects unknown provider selectors', () => {
    expect(() =>
      createConfiguredNotificationPushProvider(
        configured({ NOTIFICATION_PUSH_PROVIDER: 'automatic' }),
      ),
    ).toThrow('debe ser noop o webpush');
  });

  it('fails fast on a partial configuration without echoing secrets', () => {
    const secret = 'private-value-that-must-not-leak';
    const config = configured({ WEB_PUSH_VAPID_PRIVATE_KEY: secret });
    let message = '';
    try {
      readWebPushConfiguration(config);
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain('Configuración Web Push incompleta');
    expect(message).not.toContain(secret);
  });

  it('validates the VAPID pair and exposes only the public key', () => {
    const config = configured({
      NOTIFICATION_PUSH_PROVIDER: 'webpush',
      WEB_PUSH_VAPID_SUBJECT: 'mailto:push@example.com',
      WEB_PUSH_VAPID_PUBLIC_KEY: firstKeys.publicKey,
      WEB_PUSH_VAPID_PRIVATE_KEY: firstKeys.privateKey,
      WEB_PUSH_TTL_SECONDS: '600',
      WEB_PUSH_ALLOWED_ENDPOINT_HOSTS: 'push.example.com,*.notify.windows.com',
    });
    const parsed = readWebPushConfiguration(config);
    expect(parsed).toMatchObject({
      subject: 'mailto:push@example.com',
      ttlSeconds: 600,
      allowedEndpointHosts: ['push.example.com', '*.notify.windows.com'],
    });
    const provider = createConfiguredNotificationPushProvider(config);
    expect(provider).toBeInstanceOf(WebPushNotificationProvider);
    expect(provider.getPublicConfiguration()).toEqual({
      enabled: true,
      provider: 'web-push',
      vapidPublicKey: firstKeys.publicKey,
    });
    expect(JSON.stringify(provider.getPublicConfiguration())).not.toContain(
      firstKeys.privateKey,
    );
  });

  it('rejects public and private keys that are not a pair', () => {
    const config = configured({
      WEB_PUSH_VAPID_SUBJECT: 'https://example.com/contact',
      WEB_PUSH_VAPID_PUBLIC_KEY: firstKeys.publicKey,
      WEB_PUSH_VAPID_PRIVATE_KEY: secondKeys.privateKey,
    });
    expect(() => readWebPushConfiguration(config)).toThrow(
      'no forman un par válido',
    );
  });
});
