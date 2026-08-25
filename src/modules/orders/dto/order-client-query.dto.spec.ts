import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ConfirmOrderAccessDto } from './confirm-order-access.dto';
import { ListPublicParticipantsDto } from './list-public-participants.dto';
import { ListTopBuyersDto } from './list-top-buyers.dto';

describe('DTOs públicos de pedidos', () => {
  it('transforma y limita la paginación de participantes y ranking', async () => {
    const participants = plainToInstance(ListPublicParticipantsDto, {
      page: '2',
      limit: '500',
    });
    const ranking = plainToInstance(ListTopBuyersDto, { limit: '100' });

    expect(await validate(participants)).toHaveLength(0);
    expect(participants).toEqual(
      expect.objectContaining({ page: 2, limit: 500 }),
    );
    expect(await validate(ranking)).toHaveLength(0);
    expect(ranking.limit).toBe(100);
    await expect(
      validate(
        plainToInstance(ListPublicParticipantsDto, { page: '0', limit: '501' }),
      ),
    ).resolves.not.toHaveLength(0);
    await expect(
      validate(plainToInstance(ListTopBuyersDto, { limit: 'not-a-number' })),
    ).resolves.not.toHaveLength(0);
  });

  it('solo acepta un booleano explícito para vincular la recuperación', async () => {
    const base = { challengeId: 'a'.repeat(32), code: '123456' };
    await expect(
      validate(plainToInstance(ConfirmOrderAccessDto, base)),
    ).resolves.toHaveLength(0);
    await expect(
      validate(
        plainToInstance(ConfirmOrderAccessDto, {
          ...base,
          linkToAccount: true,
        }),
      ),
    ).resolves.toHaveLength(0);
    await expect(
      validate(
        plainToInstance(ConfirmOrderAccessDto, {
          ...base,
          linkToAccount: 'true',
        }),
      ),
    ).resolves.not.toHaveLength(0);
  });
});
