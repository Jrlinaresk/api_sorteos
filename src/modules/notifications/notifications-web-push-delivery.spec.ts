import { Types } from 'mongoose';
import { NotificationPushProvider } from './push/notification-push-provider';
import {
  NotificationDeliveryCode,
  NotificationDeliveryStatus,
  NotificationType,
} from './schemas/notification.schema';
import {
  PushProviderKind,
  PushSubscriptionDisableReason,
} from './schemas/push-subscription.schema';
import { NotificationsService } from './notifications.service';

function queryResult<T>(value: T) {
  return { exec: jest.fn().mockResolvedValue(value) };
}

function sameValue(actual: unknown, expected: unknown): boolean {
  if (actual instanceof Types.ObjectId || expected instanceof Types.ObjectId) {
    return actual?.toString() === expected?.toString();
  }
  return actual === expected;
}

function matches(document: Record<string, any>, filter: Record<string, any>) {
  return Object.entries(filter).every(([key, expected]) => {
    if (key === '$or') {
      return (expected as Record<string, any>[]).some((branch) =>
        matches(document, branch),
      );
    }
    if (key === '$and') {
      return (expected as Record<string, any>[]).every((branch) =>
        matches(document, branch),
      );
    }

    const actual = document[key];
    if (
      expected &&
      typeof expected === 'object' &&
      !(expected instanceof Date) &&
      !(expected instanceof Types.ObjectId)
    ) {
      if ('$exists' in expected) {
        return expected.$exists ? actual !== undefined : actual === undefined;
      }
      if ('$lte' in expected) {
        return actual instanceof Date && actual <= expected.$lte;
      }
      if ('$in' in expected) {
        return expected.$in.some((value: unknown) => sameValue(actual, value));
      }
    }
    return sameValue(actual, expected);
  });
}

function applyUpdate(
  document: Record<string, any>,
  update: Record<string, Record<string, any>>,
) {
  Object.assign(document, update.$set ?? {});
  for (const [field, amount] of Object.entries(update.$inc ?? {})) {
    document[field] = (document[field] ?? 0) + amount;
  }
  for (const field of Object.keys(update.$unset ?? {})) delete document[field];
}

describe('NotificationsService Web Push delivery', () => {
  function buildService(
    provider: NotificationPushProvider,
    preferenceOverrides: Record<string, unknown> = {},
    initialNotification: Record<string, unknown> = {},
  ) {
    const notificationId = new Types.ObjectId();
    const user = new Types.ObjectId();
    const expiredId = new Types.ObjectId();
    const invalidId = new Types.ObjectId();
    const notification = {
      _id: notificationId,
      id: notificationId.toString(),
      user,
      title: 'Título',
      body: 'Cuerpo',
      type: NotificationType.General,
      data: {},
      pushRequested: true,
      scheduledAt: new Date(Date.now() - 1_000),
      deliveryAttempts: 0,
      deliveryStatus: NotificationDeliveryStatus.Pending,
      deliveryProvider: undefined as string | undefined,
      deliveryCode: undefined as string | undefined,
      deliveryAccepted: 0,
      deliveryRejected: 0,
      deliveryInvalidSubscriptions: 0,
      lastDeliveryError: undefined as string | undefined,
      ...initialNotification,
    };
    const findOneAndUpdate = jest.fn(
      (filter: Record<string, any>, update: Record<string, any>) => {
        if (!matches(notification, filter)) return queryResult(null);
        applyUpdate(notification, update);
        return queryResult(notification);
      },
    );
    const notificationModel = {
      findOneAndUpdate,
      findById: jest.fn().mockImplementation(() => queryResult(notification)),
    };
    const updateMany = jest.fn().mockReturnValue(
      queryResult({
        modifiedCount: 1,
      }),
    );
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
        sort: jest.fn().mockReturnValue({
          limit: jest.fn().mockReturnValue({
            lean: jest.fn().mockReturnValue(queryResult(subscriptions)),
          }),
        }),
      }),
    };
    const preferenceModel = {
      findOneAndUpdate: jest.fn().mockReturnValue(
        queryResult({
          pushEnabled: true,
          transactionalEnabled: true,
          marketingEnabled: true,
          mutedTypes: [],
          timezoneOffsetMinutes: 0,
          ...preferenceOverrides,
        }),
      ),
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
      notificationModel,
      notificationId,
      expiredId,
      invalidId,
      updateMany,
      subscriptionModel,
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
      pushRequested: false,
      deliveryAttempts: 1,
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

  it('sorts and bounds legacy subscription delivery to the configured cap', async () => {
    const provider = {
      providerName: 'web-push',
      isConfigured: true,
      getPublicConfiguration: () => ({ enabled: true, provider: 'web-push' }),
      send: jest.fn().mockResolvedValue({
        provider: 'web-push',
        accepted: 1,
        rejected: 0,
      }),
    } as NotificationPushProvider;
    const setup = buildService(provider);

    await setup.service.deliverPush(setup.notificationId.toString());

    const query = setup.subscriptionModel.find.mock.results[0].value;
    expect(query.sort).toHaveBeenCalledWith({ lastSeenAt: -1, _id: -1 });
    expect(query.sort.mock.results[0].value.limit).toHaveBeenCalledWith(10);
    expect(setup.subscriptionModel.find).toHaveBeenCalledWith(
      expect.objectContaining({ provider: PushProviderKind.WebPush }),
    );
  });

  it('uses a persistent CAS lease so concurrent calls send only once', async () => {
    let resolveSend!: (value: {
      provider: string;
      accepted: number;
      rejected: number;
    }) => void;
    const send = jest.fn(
      () =>
        new Promise<{
          provider: string;
          accepted: number;
          rejected: number;
        }>((resolve) => {
          resolveSend = resolve;
        }),
    );
    const provider = {
      providerName: 'web-push',
      isConfigured: true,
      getPublicConfiguration: () => ({ enabled: true, provider: 'web-push' }),
      send,
    } as NotificationPushProvider;
    const setup = buildService(provider);

    const first = setup.service.deliverPush(setup.notificationId.toString());
    await new Promise((resolve) => setImmediate(resolve));
    const concurrent = await setup.service.deliverPush(
      setup.notificationId.toString(),
    );

    expect(send).toHaveBeenCalledTimes(1);
    expect(concurrent.deliveryStatus).toBe(
      NotificationDeliveryStatus.Processing,
    );

    resolveSend({ provider: 'web-push', accepted: 1, rejected: 0 });
    await first;
    expect(setup.notification.deliveryStatus).toBe(
      NotificationDeliveryStatus.Sent,
    );
  });

  it('keeps quiet-hours delivery pending and schedules the next allowed time', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-08-25T02:00:00.000Z'));
    try {
      const provider = {
        providerName: 'web-push',
        isConfigured: true,
        getPublicConfiguration: () => ({
          enabled: true,
          provider: 'web-push',
        }),
        send: jest.fn(),
      } as unknown as NotificationPushProvider;
      const setup = buildService(provider, {
        quietHoursStart: '22:00',
        quietHoursEnd: '08:00',
        timezoneOffsetMinutes: -180,
      });

      await setup.service.deliverPush(setup.notificationId.toString());

      expect(provider.send).not.toHaveBeenCalled();
      expect(setup.notification).toMatchObject({
        deliveryStatus: NotificationDeliveryStatus.Pending,
        deliveryAttempts: 0,
        pushRequested: true,
        deliveryCode: NotificationDeliveryCode.QuietHours,
        scheduledAt: new Date('2026-08-25T11:00:00.000Z'),
      });
    } finally {
      jest.useRealTimers();
    }
  });

  it('reschedules reported transient failures with backoff', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-08-25T12:00:00.000Z'));
    try {
      const provider = {
        providerName: 'web-push',
        isConfigured: true,
        getPublicConfiguration: () => ({
          enabled: true,
          provider: 'web-push',
        }),
        send: jest.fn().mockResolvedValue({
          provider: 'web-push',
          accepted: 0,
          rejected: 1,
          errorCode: 'upstream_unavailable',
          error: 'Proveedor temporalmente indisponible',
        }),
      } as NotificationPushProvider;
      const setup = buildService(provider);

      await setup.service.deliverPush(setup.notificationId.toString());

      expect(setup.notification).toMatchObject({
        deliveryStatus: NotificationDeliveryStatus.Pending,
        pushRequested: true,
        deliveryAttempts: 1,
        deliveryCode: NotificationDeliveryCode.RetryScheduled,
        scheduledAt: new Date('2026-08-25T12:00:30.000Z'),
        lastDeliveryError: 'Proveedor temporalmente indisponible',
      });
    } finally {
      jest.useRealTimers();
    }
  });

  it('marca incierto un adaptador que lanza tras iniciar el dispatch y no lo reintenta', async () => {
    const privateValue = 'private-vapid-value';
    const provider = {
      providerName: 'web-push',
      isConfigured: true,
      getPublicConfiguration: () => ({ enabled: true, provider: 'web-push' }),
      send: jest.fn().mockRejectedValue(new Error(privateValue)),
    } as NotificationPushProvider;
    const setup = buildService(provider);

    await setup.service.deliverPush(setup.notificationId.toString());

    expect(setup.notification).toMatchObject({
      deliveryStatus: NotificationDeliveryStatus.Failed,
      pushRequested: false,
      deliveryAttempts: 1,
      deliveryCode: NotificationDeliveryCode.DeliveryUncertain,
      lastDeliveryError:
        'El proveedor terminó sin confirmar el resultado; revise antes de reintentar',
    });
    expect(setup.notification.scheduledAt).toBeUndefined();
    expect(JSON.stringify(setup.notification)).not.toContain(privateValue);
  });

  it('moves an exhausted transient failure to an explicit terminal state', async () => {
    const provider = {
      providerName: 'web-push',
      isConfigured: true,
      getPublicConfiguration: () => ({ enabled: true, provider: 'web-push' }),
      send: jest.fn().mockResolvedValue({
        provider: 'web-push',
        accepted: 0,
        rejected: 1,
        errorCode: 'upstream_unavailable',
        error: 'Proveedor temporalmente indisponible',
      }),
    } as NotificationPushProvider;
    const setup = buildService(provider, {}, { deliveryAttempts: 4 });

    await setup.service.deliverPush(setup.notificationId.toString());

    expect(setup.notification).toMatchObject({
      deliveryStatus: NotificationDeliveryStatus.Failed,
      pushRequested: false,
      deliveryAttempts: 5,
      deliveryCode: NotificationDeliveryCode.AttemptsExhausted,
    });
    expect(setup.notification.scheduledAt).toBeUndefined();
  });

  it('does not resend after an expired lease when the external outcome is uncertain', async () => {
    const provider = {
      providerName: 'web-push',
      isConfigured: true,
      getPublicConfiguration: () => ({ enabled: true, provider: 'web-push' }),
      send: jest.fn(),
    } as unknown as NotificationPushProvider;
    const setup = buildService(
      provider,
      {},
      {
        deliveryStatus: NotificationDeliveryStatus.Processing,
        deliveryDispatchStartedAt: new Date(Date.now() - 10_000),
        deliveryLeaseExpiresAt: new Date(Date.now() - 1_000),
        deliveryLeaseToken: 'expired-lease',
        deliveryAttempts: 1,
      },
    );

    await setup.service.deliverPush(setup.notificationId.toString());

    expect(provider.send).not.toHaveBeenCalled();
    expect(setup.notification).toMatchObject({
      deliveryStatus: NotificationDeliveryStatus.Failed,
      pushRequested: false,
      deliveryCode: NotificationDeliveryCode.DeliveryUncertain,
      deliveryAttempts: 1,
    });
    expect(
      (setup.notification as Record<string, unknown>).deliveryLeaseToken,
    ).toBeUndefined();
  });
});
