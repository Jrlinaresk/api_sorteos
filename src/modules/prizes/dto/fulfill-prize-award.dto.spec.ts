import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { FulfillPrizeAwardDto } from './fulfill-prize-award.dto';

describe('FulfillPrizeAwardDto', () => {
  it('acepta referencia obligatoria y notas opcionales dentro de sus límites', async () => {
    const dto = plainToInstance(FulfillPrizeAwardDto, {
      reference: 'TRACKING-123',
      notes: 'Recibido por el ganador',
    });

    await expect(validate(dto)).resolves.toHaveLength(0);
  });

  it.each([
    {},
    { reference: '' },
    { reference: '   ' },
    { reference: 'x'.repeat(161) },
    { reference: 123 },
    { reference: 'OK', notes: 'x'.repeat(1001) },
    { reference: 'OK', notes: 123 },
  ])('rechaza un contrato de entrega inválido: %p', async (payload) => {
    const dto = plainToInstance(FulfillPrizeAwardDto, payload);

    await expect(validate(dto)).resolves.not.toHaveLength(0);
  });
});
