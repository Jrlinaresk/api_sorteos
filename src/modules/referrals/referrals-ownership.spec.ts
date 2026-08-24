import { Types } from 'mongoose';
import { ReferralsService } from './referrals.service';

describe('ReferralsService ownership', () => {
  it('always filters the user commission page by the JWT beneficiary', async () => {
    const userId = new Types.ObjectId();
    const findQuery = {
      sort: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      lean: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue([]),
    };
    const commissionModel = {
      find: jest.fn().mockReturnValue(findQuery),
      countDocuments: jest.fn().mockReturnValue({
        exec: jest.fn().mockResolvedValue(0),
      }),
    };
    const service = new ReferralsService(
      {} as never,
      {} as never,
      commissionModel as never,
    );

    await service.listUserCommissions(userId.toString(), {
      status: undefined,
      orderId: 'own-order',
    });

    const filter = commissionModel.find.mock.calls[0][0] as {
      beneficiaryUser: Types.ObjectId;
      orderId: string;
    };
    expect(filter.beneficiaryUser.toString()).toBe(userId.toString());
    expect(filter.orderId).toBe('own-order');
  });
});
