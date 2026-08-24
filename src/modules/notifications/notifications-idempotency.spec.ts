import { Types } from 'mongoose';
import {
  NotificationSchema,
  NotificationType,
} from './schemas/notification.schema';
import { NotificationsService } from './notifications.service';

describe('NotificationsService event idempotency', () => {
  const user = new Types.ObjectId();
  const eventKey = `payment:${new Types.ObjectId().toString()}:paid`;
  const dto = {
    userId: user.toString(),
    title: 'Pago confirmado',
    body: 'Tus títulos ya están disponibles.',
    type: NotificationType.Payment,
    eventKey,
    deliverPush: true,
  };

  function document() {
    return {
      id: new Types.ObjectId().toString(),
      user,
      eventKey,
      title: dto.title,
      body: dto.body,
      type: dto.type,
      deliveryAttempts: 1,
      save: jest.fn(),
    };
  }

  function query(value: unknown) {
    return { exec: jest.fn().mockResolvedValue(value) };
  }

  it('declares a partial unique index scoped by user and event key', () => {
    const index = NotificationSchema.indexes().find(
      ([fields]) => fields.user === 1 && fields.eventKey === 1,
    );
    expect(index?.[1]).toEqual(
      expect.objectContaining({
        unique: true,
        partialFilterExpression: { eventKey: { $type: 'string' } },
      }),
    );
  });

  it('returns an existing event without creating or redelivering it', async () => {
    const existing = document();
    const notificationModel = {
      findOne: jest.fn().mockReturnValue(query(existing)),
      create: jest.fn(),
    };
    const service = new NotificationsService(
      notificationModel as never,
      {} as never,
      {} as never,
    );
    const deliver = jest.spyOn(service, 'deliverPush');

    await expect(service.create(dto)).resolves.toBe(existing);

    expect(notificationModel.findOne).toHaveBeenCalledWith({ user, eventKey });
    expect(notificationModel.create).not.toHaveBeenCalled();
    expect(deliver).not.toHaveBeenCalled();
  });

  it('recovers the winner of a concurrent unique-key race without push duplication', async () => {
    const existing = document();
    const notificationModel = {
      findOne: jest
        .fn()
        .mockReturnValueOnce(query(null))
        .mockReturnValueOnce(query(existing)),
      create: jest.fn().mockRejectedValue({ code: 11000 }),
    };
    const service = new NotificationsService(
      notificationModel as never,
      {} as never,
      {} as never,
    );
    const deliver = jest.spyOn(service, 'deliverPush');

    await expect(service.create(dto)).resolves.toBe(existing);

    expect(notificationModel.findOne).toHaveBeenCalledTimes(2);
    expect(notificationModel.create).toHaveBeenCalledTimes(1);
    expect(deliver).not.toHaveBeenCalled();
  });

  it('persists the normalized key when creating the event for the first time', async () => {
    const created = document();
    const notificationModel = {
      findOne: jest.fn().mockReturnValue(query(null)),
      create: jest.fn().mockResolvedValue(created),
    };
    const service = new NotificationsService(
      notificationModel as never,
      {} as never,
      {} as never,
    );

    await expect(
      service.create({
        ...dto,
        eventKey: `  ${eventKey}  `,
        deliverPush: false,
      }),
    ).resolves.toBe(created);

    expect(notificationModel.create).toHaveBeenCalledWith(
      expect.objectContaining({
        user,
        eventKey,
        pushRequested: false,
        scheduledAt: undefined,
      }),
    );
  });
});
