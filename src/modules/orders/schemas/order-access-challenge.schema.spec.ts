import { OrderAccessChallengeSchema } from './order-access-challenge.schema';

describe('OrderAccessChallengeSchema', () => {
  it('oculta secretos y elimina challenges automáticamente a los 15 minutos', () => {
    expect(OrderAccessChallengeSchema.path('codeHash').options.select).toBe(
      false,
    );
    expect(OrderAccessChallengeSchema.path('orderIds').options.select).toBe(
      false,
    );
    expect(OrderAccessChallengeSchema.path('identityHash').options.select).toBe(
      false,
    );
    expect(OrderAccessChallengeSchema.path('truncated').options.select).toBe(
      false,
    );
    expect(OrderAccessChallengeSchema.path('attempts').options.max).toBe(5);
    expect(OrderAccessChallengeSchema.indexes()).toContainEqual([
      { expiresAt: 1 },
      { expireAfterSeconds: 0, background: true },
    ]);
    expect(OrderAccessChallengeSchema.indexes()).toContainEqual([
      { identityHash: 1 },
      { unique: true, background: true },
    ]);
  });
});
