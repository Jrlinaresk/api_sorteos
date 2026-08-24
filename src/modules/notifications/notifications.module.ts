import { DynamicModule, Module, ModuleMetadata, Type } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { AuthModule } from '../auth/auth.module';
import { NotificationsAdminController } from './notifications-admin.controller';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import {
  NOTIFICATION_PUSH_PROVIDER,
  NotificationPushProvider,
} from './push/notification-push-provider';
import { createConfiguredNotificationPushProvider } from './push/configured-notification-push.provider';
import {
  Notification,
  NotificationSchema,
} from './schemas/notification.schema';
import {
  NotificationPreference,
  NotificationPreferenceSchema,
} from './schemas/notification-preference.schema';
import {
  PushSubscription,
  PushSubscriptionSchema,
} from './schemas/push-subscription.schema';

type PushProviderRegistration =
  | { useClass: Type<NotificationPushProvider> }
  | { useValue: NotificationPushProvider }
  | {
      useFactory: (
        ...args: any[]
      ) => NotificationPushProvider | Promise<NotificationPushProvider>;
      inject?: any[];
    };

export interface NotificationsModuleOptions {
  imports?: ModuleMetadata['imports'];
  provider: PushProviderRegistration;
}

@Module({
  imports: [
    ConfigModule,
    AuthModule,
    MongooseModule.forFeature([
      { name: Notification.name, schema: NotificationSchema },
      { name: PushSubscription.name, schema: PushSubscriptionSchema },
      {
        name: NotificationPreference.name,
        schema: NotificationPreferenceSchema,
      },
    ]),
  ],
  controllers: [NotificationsController, NotificationsAdminController],
  providers: [
    NotificationsService,
    {
      provide: NOTIFICATION_PUSH_PROVIDER,
      inject: [ConfigService],
      useFactory: createConfiguredNotificationPushProvider,
    },
  ],
  exports: [NotificationsService, NOTIFICATION_PUSH_PROVIDER],
})
export class NotificationsModule {
  /** register() permite sustituir la selección automática Web Push/no-op. */
  static register(options: NotificationsModuleOptions): DynamicModule {
    return {
      module: NotificationsModule,
      imports: options.imports,
      providers: [
        {
          provide: NOTIFICATION_PUSH_PROVIDER,
          ...options.provider,
        },
      ],
      exports: [NOTIFICATION_PUSH_PROVIDER],
    };
  }
}
