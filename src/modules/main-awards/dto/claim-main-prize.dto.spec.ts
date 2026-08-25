import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ClaimMainPrizeDto } from './claim-main-prize.dto';
import { MainPrizeChoice } from '../schemas/main-prize-award.schema';

describe('ClaimMainPrizeDto', () => {
  const delivery = {
    recipientName: 'Maria da Silva',
    phone: '+55 11 99999-9999',
    address: 'Rua das Flores, 123, São Paulo - SP',
    instructions: 'Entregar en portería',
  };

  it('exige y valida datos logísticos cuando se elige el bien físico', async () => {
    await expect(
      validate(
        plainToInstance(ClaimMainPrizeDto, {
          choice: MainPrizeChoice.Physical,
          delivery,
        }),
      ),
    ).resolves.toHaveLength(0);
    await expect(
      validate(
        plainToInstance(ClaimMainPrizeDto, {
          choice: MainPrizeChoice.Physical,
        }),
      ),
    ).resolves.not.toHaveLength(0);
    await expect(
      validate(
        plainToInstance(ClaimMainPrizeDto, {
          choice: MainPrizeChoice.Physical,
          delivery: { ...delivery, phone: 'abc' },
        }),
      ),
    ).resolves.not.toHaveLength(0);
    await expect(
      validate(
        plainToInstance(ClaimMainPrizeDto, {
          choice: MainPrizeChoice.Physical,
          delivery: { ...delivery, phone: '........' },
        }),
      ),
    ).resolves.not.toHaveLength(0);
  });

  it('no exige datos logísticos para la alternativa en efectivo', async () => {
    await expect(
      validate(
        plainToInstance(ClaimMainPrizeDto, {
          choice: MainPrizeChoice.Cash,
        }),
      ),
    ).resolves.toHaveLength(0);
  });
});
