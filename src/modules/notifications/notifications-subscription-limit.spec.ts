import {
  BadRequestException,
  ConflictException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Types } from 'mongoose';
import { NotificationPushProvider } from './push/notification-push-provider';
import { PushProviderKind } from './schemas/push-subscription.schema';
import { NotificationsService } from './notifications.service';

describe('NotificationsService subscription capacity', () => {
  const userId = new Types.ObjectId();
  const dto = {
    provider: PushProviderKind.WebPush,
    address: 'https://fcm.googleapis.com/fcm/send/subscription',
    credentials: { p256dh: 'opaque', auth: 'opaque' },
  };
  const configuredProvider: NotificationPushProvider = {
    providerName: 'web-push',
    isConfigured: true,
    getPublicConfiguration: () => ({ enabled: true, provider: 'web-push' }),
    validateSubscription: (candidate) => candidate,
    send: jest.fn(),
  };

  function findOwner(value: unknown) {
    return {
      select: jest.fn().mockReturnValue({
        lean: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue(value),
        }),
      }),
    };
  }

  function preferenceModel() {
    return {
      findOneAndUpdate: jest.fn().mockReturnValue({
        exec: jest.fn().mockResolvedValue({}),
      }),
    };
  }

  it('rejects registration while the explicit provider is disabled', async () => {
    const service = new NotificationsService(
      {} as never,
      {} as never,
      {} as never,
      {
        providerName: 'noop',
        isConfigured: false,
        getPublicConfiguration: () => ({ enabled: false, provider: 'noop' }),
        send: jest.fn(),
      },
    );

    await expect(
      service.registerSubscription(userId.toString(), dto),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('only accepts the subscription kind supported by webpush', async () => {
    const service = new NotificationsService(
      {} as never,
      {} as never,
      {} as never,
      configuredProvider,
    );

    await expect(
      service.registerSubscription(userId.toString(), {
        provider: PushProviderKind.Fcm,
        address: 'opaque-token',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('uses the next unique slot after a concurrent slot collision', async () => {
    const subscription = {
      _id: new Types.ObjectId(),
      user: userId,
      ...dto,
      enabled: true,
      activeSlot: 1,
      lastSeenAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const exec = jest
      .fn()
      .mockRejectedValueOnce({ code: 11000 })
      .mockResolvedValueOnce(subscription);
    const subscriptionModel = {
      findOne: jest.fn().mockImplementation(() => findOwner(null)),
      updateMany: jest.fn().mockReturnValue({
        exec: jest.fn().mockResolvedValue({ modifiedCount: 0 }),
      }),
      findOneAndUpdate: jest.fn().mockReturnValue({ exec }),
    };
    const service = new NotificationsService(
      {} as never,
      subscriptionModel as never,
      preferenceModel() as never,
      configuredProvider,
      new ConfigService({ WEB_PUSH_MAX_SUBSCRIPTIONS_PER_USER: '2' }),
    );

    await expect(
      service.registerSubscription(userId.toString(), dto),
    ).resolves.toMatchObject({ enabled: true });
    expect(subscriptionModel.findOneAndUpdate).toHaveBeenCalledTimes(2);
    expect(subscriptionModel.findOneAndUpdate.mock.calls[0][1].$set).toEqual(
      expect.objectContaining({ activeSlot: 0 }),
    );
    expect(subscriptionModel.findOneAndUpdate.mock.calls[1][1].$set).toEqual(
      expect.objectContaining({ activeSlot: 1 }),
    );
    expect(subscriptionModel.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ user: userId, enabled: true }),
      expect.objectContaining({
        $set: expect.objectContaining({
          disableReason: 'capacity_exceeded',
        }),
      }),
    );
  });

  it('returns a bounded conflict when all atomic slots are occupied', async () => {
    const subscriptionModel = {
      findOne: jest.fn().mockImplementation(() => findOwner(null)),
      updateMany: jest.fn().mockReturnValue({
        exec: jest.fn().mockResolvedValue({ modifiedCount: 0 }),
      }),
      findOneAndUpdate: jest.fn().mockReturnValue({
        exec: jest.fn().mockRejectedValue({ code: 11000 }),
      }),
    };
    const service = new NotificationsService(
      {} as never,
      subscriptionModel as never,
      preferenceModel() as never,
      configuredProvider,
      new ConfigService({ WEB_PUSH_MAX_SUBSCRIPTIONS_PER_USER: '2' }),
    );

    await expect(
      service.registerSubscription(userId.toString(), dto),
    ).rejects.toThrow(
      'El usuario alcanzó el máximo de 2 suscripciones push activas',
    );
    await expect(
      service.registerSubscription(userId.toString(), dto),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});
