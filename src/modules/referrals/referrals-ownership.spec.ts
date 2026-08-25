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

  it('marca como compartibles solo los códigos utilizables en este momento', async () => {
    const userId = new Types.ObjectId();
    const aggregate = { exec: jest.fn().mockResolvedValue([]) };
    const codeQuery = {
      select: jest.fn().mockReturnThis(),
      sort: jest.fn().mockReturnThis(),
      lean: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue([
        {
          code: 'DISPONIBLE',
          status: 'active',
          clicksCount: 1,
          conversionsCount: 0,
        },
        {
          code: 'AGOTADO1',
          status: 'active',
          maxConversions: 2,
          clicksCount: 4,
          conversionsCount: 2,
        },
        {
          code: 'FUTURO01',
          status: 'active',
          validFrom: new Date(Date.now() + 60_000),
          clicksCount: 0,
          conversionsCount: 0,
        },
      ]),
    };
    const codeModel = { find: jest.fn().mockReturnValue(codeQuery) };
    const commissionModel = {
      aggregate: jest.fn().mockReturnValue(aggregate),
    };
    const service = new ReferralsService(
      codeModel as never,
      {} as never,
      commissionModel as never,
    );

    const summary = await service.userSummary(userId.toString());

    expect(summary.codes.map((code) => [code.code, code.usable])).toEqual([
      ['DISPONIBLE', true],
      ['AGOTADO1', false],
      ['FUTURO01', false],
    ]);
    expect(codeQuery.select).toHaveBeenCalledWith(
      expect.stringContaining('maxConversions'),
    );
  });

  it('asigna retención física a los datos de navegación del referido', async () => {
    const codeId = new Types.ObjectId();
    const codeModel = {
      findOne: jest.fn().mockReturnValue({
        exec: jest.fn().mockResolvedValue({
          _id: codeId,
          code: 'SOCIO123',
          status: 'active',
          conversionsCount: 0,
        }),
      }),
      updateOne: jest.fn().mockReturnValue({
        exec: jest.fn().mockResolvedValue({ modifiedCount: 1 }),
      }),
    };
    const clickModel = {
      findOne: jest.fn().mockReturnValue({
        exec: jest.fn().mockResolvedValue(null),
      }),
      create: jest.fn(async (value) => ({ id: 'click-id', ...value })),
    };
    const service = new ReferralsService(
      codeModel as never,
      clickModel as never,
      {} as never,
    );
    const startedAt = Date.now();

    await service.captureClick({
      code: 'SOCIO123',
      eventId: 'click-event-id',
    });

    expect(clickModel.create).toHaveBeenCalledWith(
      expect.objectContaining({
        expiresAt: expect.any(Date),
      }),
    );
    const expiresAt = clickModel.create.mock.calls[0][0].expiresAt as Date;
    expect(expiresAt.getTime()).toBeGreaterThan(
      startedAt + 179 * 24 * 60 * 60_000,
    );
  });
});
