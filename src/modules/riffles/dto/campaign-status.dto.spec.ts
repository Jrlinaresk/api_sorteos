import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateRaffleDto } from './create-raffle.dto';
import { UpdateRaffleDto } from '../enums/update-raffle.dto';
import { CampaignStatus, DrawMethod } from '../schema/raffle.schema';

const validationOptions = {
  whitelist: true,
  forbidNonWhitelisted: true,
};

describe('campaign status DTO boundary', () => {
  const creation = (status: CampaignStatus) =>
    plainToInstance(CreateRaffleDto, {
      name: 'Campaña',
      totalTitles: 100,
      quotaDigits: 2,
      itemPrice: 1_000,
      ticketPrice: 1,
      prizeTitle: 'Premio',
      drawMethod: DrawMethod.ManualExternal,
      status,
    });

  it.each([CampaignStatus.Draft, CampaignStatus.Scheduled])(
    'permite crear como %s',
    async (status) => {
      const errors = await validate(creation(status), validationOptions);
      expect(
        errors.find((error) => error.property === 'status'),
      ).toBeUndefined();
    },
  );

  it.each([
    CampaignStatus.Active,
    CampaignStatus.Expired,
    CampaignStatus.AwaitingDraw,
    CampaignStatus.Drawn,
    CampaignStatus.Cancelled,
  ])('rechaza crear directamente como %s', async (status) => {
    const errors = await validate(creation(status), validationOptions);
    expect(errors.find((error) => error.property === 'status')).toBeDefined();
  });

  it('rechaza status en UpdateRaffleDto para impedir el bypass', async () => {
    const dto = plainToInstance(UpdateRaffleDto, {
      description: 'contenido seguro',
      status: CampaignStatus.Drawn,
    });
    const errors = await validate(dto, validationOptions);
    expect(errors.find((error) => error.property === 'status')).toBeDefined();
  });

  it('acepta limpiar fechas opcionales y sugerencias en un borrador', async () => {
    const dto = plainToInstance(UpdateRaffleDto, {
      launchAt: null,
      closesAt: null,
      drawDate: null,
      quantitySuggestions: [],
    });

    await expect(validate(dto, validationOptions)).resolves.toEqual([]);
  });
});
