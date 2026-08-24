import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { VerifyCryptographicDrawDto } from './cryptographic-draw.dto';

describe('VerifyCryptographicDrawDto', () => {
  it('no permite que el operador elija la entropía externa', async () => {
    const dto = plainToInstance(VerifyCryptographicDrawDto, {
      reveal: 'secret-material-at-least-16',
      externalEntropy: 'operator-controlled',
      sourceUrl: 'https://operator.example/evidence',
    });
    const errors = await validate(dto, {
      whitelist: true,
      forbidNonWhitelisted: true,
    });

    expect(errors.map((error) => error.property)).toEqual(
      expect.arrayContaining(['externalEntropy', 'sourceUrl']),
    );
  });
});
