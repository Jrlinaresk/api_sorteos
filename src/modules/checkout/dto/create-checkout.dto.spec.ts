import { ValidationPipe } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateCheckoutDto } from './create-checkout.dto';

describe('CreateCheckoutDto', () => {
  const valid = {
    campaignSlug: 'titan-160',
    quantity: 500,
    buyer: {
      name: 'Maria da Silva',
      phone: '+5511999999999',
      email: 'maria@example.com',
      cpf: '52998224725',
    },
    termsVersion: 'v1',
    idempotencyKey: 'checkout-client-request-001',
  };

  it('requires a strong idempotency key', async () => {
    const errors = await validate(
      plainToInstance(CreateCheckoutDto, { ...valid, idempotencyKey: 'short' }),
    );
    expect(errors.some((error) => error.property === 'idempotencyKey')).toBe(
      true,
    );
  });

  it('rejects a client-controlled amount property at the endpoint boundary', async () => {
    const pipe = new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
    });
    await expect(
      pipe.transform(
        { ...valid, amount: 0.01 },
        { type: 'body', metatype: CreateCheckoutDto },
      ),
    ).rejects.toThrow();
  });
});
