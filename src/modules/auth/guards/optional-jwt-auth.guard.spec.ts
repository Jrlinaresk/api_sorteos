import { UnauthorizedException } from '@nestjs/common';
import { OptionalJwtAuthGuard } from './optional-jwt-auth.guard';

function context(authorization?: string) {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ headers: { authorization } }),
    }),
  } as never;
}

describe('OptionalJwtAuthGuard', () => {
  const guard = new OptionalJwtAuthGuard();

  it('permite checkout invitado únicamente cuando no se envió Authorization', () => {
    expect(
      guard.handleRequest(undefined, false, undefined, context()),
    ).toBeUndefined();
  });

  it('conserva al usuario autenticado y no degrada un token inválido a invitado', () => {
    const user = { id: 'user-id' };
    expect(
      guard.handleRequest(
        undefined,
        user,
        undefined,
        context('Bearer valid'),
      ),
    ).toBe(user);
    expect(() =>
      guard.handleRequest(
        undefined,
        false,
        undefined,
        context('Bearer invalid'),
      ),
    ).toThrow(UnauthorizedException);
  });
});
