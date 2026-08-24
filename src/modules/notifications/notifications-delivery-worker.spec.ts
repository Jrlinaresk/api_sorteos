import { Types } from 'mongoose';
import { NotificationDeliveryStatus } from './schemas/notification.schema';
import { NotificationsService } from './notifications.service';

describe('NotificationsService delivery worker', () => {
  it('loads only due requested pushes and processes each candidate', async () => {
    const ids = [new Types.ObjectId(), new Types.ObjectId()];
    const exec = jest.fn().mockResolvedValue(ids.map((_id) => ({ _id })));
    const select = jest.fn().mockReturnValue({ lean: () => ({ exec }) });
    const limit = jest.fn().mockReturnValue({ select });
    const sort = jest.fn().mockReturnValue({ limit });
    const find = jest.fn().mockReturnValue({ sort });
    const service = new NotificationsService(
      { find } as never,
      {} as never,
      {} as never,
    );
    const deliver = jest
      .spyOn(service as any, 'deliverPushInternal')
      .mockResolvedValue({});

    await expect(service.processPendingPushDeliveries()).resolves.toBe(2);

    expect(find).toHaveBeenCalledWith(
      expect.objectContaining({
        pushRequested: true,
        $or: expect.arrayContaining([
          expect.objectContaining({
            deliveryStatus: NotificationDeliveryStatus.Pending,
          }),
          expect.objectContaining({
            deliveryStatus: NotificationDeliveryStatus.Processing,
          }),
        ]),
      }),
    );
    expect(limit).toHaveBeenCalledWith(25);
    expect(deliver).toHaveBeenCalledTimes(2);
    expect(deliver).toHaveBeenNthCalledWith(1, ids[0].toString(), true);
    expect(deliver).toHaveBeenNthCalledWith(2, ids[1].toString(), true);
  });
});
