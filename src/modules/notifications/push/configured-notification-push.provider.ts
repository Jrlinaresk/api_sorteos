import { ConfigService } from '@nestjs/config';
import { NoopNotificationPushProvider } from './noop-notification-push.provider';
import { NotificationPushProvider } from './notification-push-provider';
import {
  ConfiguredNotificationPushProvider,
  readConfiguredNotificationPushProvider,
  readWebPushConfiguration,
} from './web-push.config';
import { WebPushNotificationProvider } from './web-push-notification.provider';

export function createConfiguredNotificationPushProvider(
  config: ConfigService,
): NotificationPushProvider {
  const provider = readConfiguredNotificationPushProvider(config);
  if (provider === ConfiguredNotificationPushProvider.Noop) {
    return new NoopNotificationPushProvider();
  }

  const webPushConfig = readWebPushConfiguration(config);
  if (!webPushConfig) {
    throw new Error(
      'NOTIFICATION_PUSH_PROVIDER=webpush requiere WEB_PUSH_VAPID_SUBJECT, WEB_PUSH_VAPID_PUBLIC_KEY y WEB_PUSH_VAPID_PRIVATE_KEY',
    );
  }
  return new WebPushNotificationProvider(webPushConfig);
}
