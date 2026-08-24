import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreatePaymentDto } from './create-payment.dto';

const objectId = '66c123456789012345678901';

describe('CreatePaymentDto', () => {
  it('accepts an order payment with two-decimal BRL amount', async () => {
    const dto = plainToInstance(CreatePaymentDto, {
      orderId: objectId,
      campaignId: objectId,
      userId: objectId,
      amount: 34.99,
      idempotencyKey: 'order:66c123456789012345678901:attempt:1',
      payer: { name: 'Maria da Silva', cpf: '12345678909' },
    });

    expect(await validate(dto)).toHaveLength(0);
  });

  it('accepts a guest checkout without userId', async () => {
    const dto = plainToInstance(CreatePaymentDto, {
      orderId: objectId,
      campaignId: objectId,
      amount: 34.99,
      idempotencyKey: 'checkout:66c123456789012345678901',
      payer: { name: 'Maria da Silva', cpf: '12345678909' },
    });

    expect(await validate(dto)).toHaveLength(0);
  });

  it('rejects an amount with fractions of a cent', async () => {
    const dto = plainToInstance(CreatePaymentDto, {
      orderId: objectId,
      campaignId: objectId,
      userId: objectId,
      amount: 0.071,
      idempotencyKey: 'order:66c123456789012345678901:attempt:1',
    });

    const errors = await validate(dto);
    expect(errors.some((error) => error.property === 'amount')).toBe(true);
  });

  it('rejects malformed object references and weak idempotency keys', async () => {
    const dto = plainToInstance(CreatePaymentDto, {
      orderId: 'not-an-id',
      campaignId: objectId,
      userId: objectId,
      amount: 10,
      idempotencyKey: 'short',
    });

    const errors = await validate(dto);
    expect(errors.map((error) => error.property)).toEqual(
      expect.arrayContaining(['orderId', 'idempotencyKey']),
    );
  });
});
