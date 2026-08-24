import { ConflictException } from '@nestjs/common';
import { createECDH, randomBytes } from 'node:crypto';
import { Types } from 'mongoose';
import { PushProviderKind } from './schemas/push-subscription.schema';
import { NotificationsService } from './notifications.service';

describe('NotificationsService ownership', () => {
  it('includes both notification and JWT user in the mark-read filter', async () => {
    const notificationId = new Types.ObjectId();
    const userId = new Types.ObjectId();
    const now = new Date();
    const exec = jest.fn().mockResolvedValue({
      _id: notificationId,
      user: userId,
      title: 'Título',
      body: 'Cuerpo',
      type: 'general',
      data: {},
      createdAt: now,
    });
    const notificationModel = {
      findOneAndUpdate: jest.fn().mockReturnValue({ exec }),
    };
    const service = new NotificationsService(
      notificationModel as never,
      {} as never,
      {} as never,
    );

    await service.markRead(notificationId.toString(), userId.toString());

    const filter = notificationModel.findOneAndUpdate.mock.calls[0][0] as {
      _id: Types.ObjectId;
      user: Types.ObjectId;
    };
    expect(filter._id.toString()).toBe(notificationId.toString());
    expect(filter.user.toString()).toBe(userId.toString());
  });

  it('does not let a user take over another user push endpoint', async () => {
    const currentUserId = new Types.ObjectId();
    const otherUserId = new Types.ObjectId();
    const subscriptionModel = {
      findOne: jest.fn().mockReturnValue({
        select: jest.fn().mockReturnValue({
          lean: jest.fn().mockReturnValue({
            exec: jest.fn().mockResolvedValue({ user: otherUserId }),
          }),
        }),
      }),
    };
    const service = new NotificationsService(
      {} as never,
      subscriptionModel as never,
      {} as never,
      {
        providerName: 'web-push',
        isConfigured: true,
        getPublicConfiguration: () => ({
          enabled: true,
          provider: 'web-push',
        }),
        send: jest.fn(),
      },
    );
    const browserCurve = createECDH('prime256v1');
    browserCurve.generateKeys();

    await expect(
      service.registerSubscription(currentUserId.toString(), {
        provider: PushProviderKind.WebPush,
        address: 'https://fcm.googleapis.com/fcm/send/subscription',
        credentials: {
          p256dh: browserCurve.getPublicKey().toString('base64url'),
          auth: randomBytes(16).toString('base64url'),
        },
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});
