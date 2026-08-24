import { ConfigService } from '@nestjs/config';
import { NoopNotificationPushProvider } from './noop-notification-push.provider';
import { NotificationPushProvider } from './notification-push-provider';
import {
  readAllowedWebPushEndpointHosts,
  readWebPushConfiguration,
} from './web-push.config';
import { WebPushNotificationProvider } from './web-push-notification.provider';

export function createConfiguredNotificationPushProvider(
  config: ConfigService,
): NotificationPushProvider {
  const webPushConfig = readWebPushConfiguration(config);
  return webPushConfig
    ? new WebPushNotificationProvider(webPushConfig)
    : new NoopNotificationPushProvider(readAllowedWebPushEndpointHosts(config));
}
