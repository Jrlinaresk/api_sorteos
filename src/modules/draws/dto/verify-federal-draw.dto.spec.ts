import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { VerifyFederalDrawDto } from './verify-federal-draw.dto';

describe('VerifyFederalDrawDto', () => {
  it('solo acepta un cuerpo vacío para disparar la conciliación', async () => {
    const valid = plainToInstance(VerifyFederalDrawDto, {});
    expect(
      await validate(valid, {
        whitelist: true,
        forbidNonWhitelisted: true,
      }),
    ).toHaveLength(0);
  });

  it.each([
    'contest',
    'firstPrize',
    'secondPrize',
    'sourceUrl',
    'extraction',
    'additionalOutcomes',
  ])('rechaza el campo administrativo no confiable %s', async (field) => {
    const dto = plainToInstance(VerifyFederalDrawDto, {
      [field]: field === 'sourceUrl' ? 'https://evil.example' : '123456',
    });
    const errors = await validate(dto, {
      whitelist: true,
      forbidNonWhitelisted: true,
    });
    expect(errors.some((error) => error.property === field)).toBe(true);
  });
});
