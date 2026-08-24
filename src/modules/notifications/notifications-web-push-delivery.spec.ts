import { Types } from 'mongoose';
import { NotificationPushProvider } from './push/notification-push-provider';
import {
  NotificationDeliveryStatus,
  NotificationType,
} from './schemas/notification.schema';
import {
  PushProviderKind,
  PushSubscriptionDisableReason,
} from './schemas/push-subscription.schema';
import { NotificationsService } from './notifications.service';

describe('NotificationsService Web Push delivery', () => {
  function buildService(provider: NotificationPushProvider) {
    const notificationId = new Types.ObjectId();
    const user = new Types.ObjectId();
    const expiredId = new Types.ObjectId();
    const invalidId = new Types.ObjectId();
    const notification = {
      id: notificationId.toString(),
      user,
      title: 'Título',
      body: 'Cuerpo',
      type: NotificationType.General,
      data: {},
      deliveryAttempts: 0,
      deliveryStatus: NotificationDeliveryStatus.Pending,
      deliveryProvider: undefined as string | undefined,
      deliveryCode: undefined as string | undefined,
      deliveryAccepted: 0,
      deliveryRejected: 0,
      deliveryInvalidSubscriptions: 0,
      lastDeliveryError: undefined as string | undefined,
      save: jest.fn().mockImplementation(function () {
        return Promise.resolve(this);
      }),
    };
    const notificationModel = {
      findById: jest.fn().mockReturnValue({
        exec: jest.fn().mockResolvedValue(notification),
      }),
    };
    const updateMany = jest.fn().mockReturnValue({
      exec: jest.fn().mockResolvedValue({ modifiedCount: 1 }),
    });
    const subscriptions = [
      {
        _id: new Types.ObjectId(),
        provider: PushProviderKind.WebPush,
        address: 'https://fcm.googleapis.com/fcm/send/token',
        credentials: { p256dh: 'opaque', auth: 'opaque' },
      },
    ];
    const subscriptionModel = {
      updateMany,
      find: jest.fn().mockReturnValue({
        lean: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue(subscriptions),
        }),
      }),
    };
    const preferenceModel = {
      findOneAndUpdate: jest.fn().mockReturnValue({
        exec: jest.fn().mockResolvedValue({
          pushEnabled: true,
          transactionalEnabled: true,
          marketingEnabled: true,
          mutedTypes: [],
          timezoneOffsetMinutes: 0,
        }),
      }),
    };
    const service = new NotificationsService(
      notificationModel as never,
      subscriptionModel as never,
      preferenceModel as never,
      provider,
    );
    return {
      service,
      notification,
      notificationId,
      expiredId,
      invalidId,
      updateMany,
    };
  }

  it('persists clear counts and disables 404/410 or invalid targets', async () => {
    const send = jest.fn();
    const provider = {
      providerName: 'web-push',
      isConfigured: true,
      getPublicConfiguration: () => ({ enabled: true, provider: 'web-push' }),
      send,
    } as NotificationPushProvider;
    const setup = buildService(provider);
    send.mockResolvedValue({
      provider: 'web-push',
      accepted: 1,
      rejected: 2,
      errorCode: 'partial_failure',
      error: 'Web Push: resultado parcial',
      expiredSubscriptionIds: [setup.expiredId.toString()],
      invalidSubscriptionIds: [setup.invalidId.toString()],
    });

    await setup.service.deliverPush(setup.notificationId.toString());

    expect(setup.notification).toMatchObject({
      deliveryStatus: NotificationDeliveryStatus.PartiallySent,
      deliveryProvider: 'web-push',
      deliveryCode: 'partial_failure',
      deliveryAccepted: 1,
      deliveryRejected: 2,
      deliveryInvalidSubscriptions: 2,
    });
    const updates = setup.updateMany.mock.calls.map((call) => call[1]);
    expect(updates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          $set: expect.objectContaining({
            disableReason: PushSubscriptionDisableReason.Expired,
          }),
        }),
        expect.objectContaining({
          $set: expect.objectContaining({
            disableReason: PushSubscriptionDisableReason.Invalid,
          }),
        }),
      ]),
    );
  });

  it('never persists an unexpected provider exception or its secrets', async () => {
    const privateValue = 'private-vapid-value';
    const provider = {
      providerName: 'web-push',
      isConfigured: true,
      getPublicConfiguration: () => ({ enabled: true, provider: 'web-push' }),
      send: jest.fn().mockRejectedValue(new Error(privateValue)),
    } as NotificationPushProvider;
    const setup = buildService(provider);

    await setup.service.deliverPush(setup.notificationId.toString());

    expect(setup.notification.deliveryStatus).toBe(
      NotificationDeliveryStatus.Failed,
    );
    expect(setup.notification.lastDeliveryError).toBe(
      'Fallo inesperado del proveedor push',
    );
    expect(JSON.stringify(setup.notification)).not.toContain(privateValue);
  });
});
