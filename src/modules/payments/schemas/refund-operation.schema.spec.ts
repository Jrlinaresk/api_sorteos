import { RefundOperationSchema } from './refund-operation.schema';
import { PaymentSchema } from './payment.schema';

describe('financial ledger schemas', () => {
  it('enforces one refund operation per payment and idempotency key', () => {
    expect(RefundOperationSchema.indexes()).toEqual(
      expect.arrayContaining([
        [
          { payment: 1, idempotencyKey: 1 },
          expect.objectContaining({ unique: true }),
        ],
      ]),
    );
  });

  it('stores refund reservation and received amounts as integer cents', () => {
    const paths = PaymentSchema.paths;
    expect(paths.amountCents.options.required).toBe(true);
    expect(paths.receivedAmountCents.options.default).toBe(0);
    expect(paths.refundReservedAmountCents.options.default).toBe(0);
    expect(paths.refundedAmountCents.options.default).toBe(0);
  });
});
