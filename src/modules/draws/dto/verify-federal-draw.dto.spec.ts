import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { VerifyFederalDrawDto } from './verify-federal-draw.dto';

describe('VerifyFederalDrawDto', () => {
  it('solo acepta el disparo de conciliación y resultados adicionales', async () => {
    const valid = plainToInstance(VerifyFederalDrawDto, {
      additionalOutcomes: [
        { prizeTitle: 'Segundo premio interno', winningNumber: '000123' },
      ],
    });
    expect(
      await validate(valid, {
        whitelist: true,
        forbidNonWhitelisted: true,
      }),
    ).toHaveLength(0);
  });

  it.each(['contest', 'firstPrize', 'secondPrize', 'sourceUrl', 'extraction'])(
    'rechaza el campo administrativo no confiable %s',
    async (field) => {
      const dto = plainToInstance(VerifyFederalDrawDto, {
        [field]: field === 'sourceUrl' ? 'https://evil.example' : '123456',
      });
      const errors = await validate(dto, {
        whitelist: true,
        forbidNonWhitelisted: true,
      });
      expect(errors.some((error) => error.property === field)).toBe(true);
    },
  );
});
