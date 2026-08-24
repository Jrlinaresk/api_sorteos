import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
import { PrizesService } from './prizes.service';
import {
  InstantPrizeStatus,
  PrizeMechanic,
} from './schemas/instant-prize.schema';
import { PrizeAwardStatus } from './schemas/prize-award.schema';

function query<T>(value: T) {
  const chain: Record<string, jest.Mock> = {
    exec: jest.fn().mockResolvedValue(value),
  };
  for (const method of ['populate', 'sort', 'skip', 'limit', 'lean']) {
    chain[method] = jest.fn().mockReturnValue(chain);
  }
  return chain;
}

describe('PrizesService administrative inventory', () => {
  const campaignId = new Types.ObjectId().toString();

  it('lista definiciones paginadas y filtrables después de recargar', async () => {
    const rows = [{ _id: new Types.ObjectId(), title: 'R$ 500' }];
    const findQuery = query(rows);
    const prizeModel = {
      find: jest.fn().mockReturnValue(findQuery),
      countDocuments: jest.fn().mockResolvedValue(1),
    };
    const service = new PrizesService(
      prizeModel as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );

    const result = await service.listAdminPrizes({
      page: 2,
      limit: 25,
      campaignId,
      mechanic: PrizeMechanic.Roulette,
      status: InstantPrizeStatus.Active,
      search: 'R$ 500',
    });

    expect(result.data).toBe(rows);
    expect(result.meta).toEqual({
      page: 2,
      limit: 25,
      total: 1,
      pages: 1,
      hasNextPage: false,
    });
    expect(prizeModel.find).toHaveBeenCalledWith(
      expect.objectContaining({
        campaign: expect.any(Types.ObjectId),
        mechanic: PrizeMechanic.Roulette,
        status: InstantPrizeStatus.Active,
        $or: expect.any(Array),
      }),
    );
    expect(findQuery.skip).toHaveBeenCalledWith(25);
  });

  it('lista la cola administrativa de adjudicaciones con sus publicId', async () => {
    const rows = [
      { publicId: '14af4058-dbf7-48a0-938d-d5f1c6899d86', title: 'Premio' },
    ];
    const awardModel = {
      find: jest.fn().mockReturnValue(query(rows)),
      countDocuments: jest.fn().mockResolvedValue(1),
    };
    const service = new PrizesService(
      {} as never,
      {} as never,
      awardModel as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );

    const result = await service.listAdminAwards({
      page: 1,
      limit: 50,
      campaignId,
      status: PrizeAwardStatus.Claimed,
    });

    expect(result.data).toEqual(rows);
    expect(awardModel.find).toHaveBeenCalledWith({
      campaign: expect.any(Types.ObjectId),
      status: PrizeAwardStatus.Claimed,
    });
  });

  it('rechaza identificadores inválidos y distingue un award inexistente', async () => {
    const awardModel = {
      findOne: jest.fn().mockReturnValue(query(null)),
    };
    const service = new PrizesService(
      {} as never,
      {} as never,
      awardModel as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );

    await expect(service.findAdminAward('no-es-uuid')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(
      service.findAdminAward('14af4058-dbf7-48a0-938d-d5f1c6899d86'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
