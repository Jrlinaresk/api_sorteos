import { GUARDS_METADATA } from '@nestjs/common/constants';
import { OptionalJwtAuthGuard } from '../auth/guards/optional-jwt-auth.guard';
import { PublicUserDto } from '../users/dto/public-user.dto';
import { PrizesController } from './prizes.controller';
import { PrizesService } from './prizes.service';

describe('PrizesController owner access', () => {
  const guardedMethods = ['listAttempts', 'listAwards', 'play'] as const;

  it.each(guardedMethods)('%s acepta autenticación JWT opcional', (method) => {
    expect(
      Reflect.getMetadata(GUARDS_METADATA, PrizesController.prototype[method]),
    ).toContain(OptionalJwtAuthGuard);
  });

  it('propaga la identidad Bearer a intentos, premios y juego', () => {
    const prizes = {
      listAttemptsForOrder: jest.fn(),
      listAwardsForOrder: jest.fn(),
      playAttempt: jest.fn(),
    } as unknown as PrizesService;
    const controller = new PrizesController(prizes);
    const user = { id: 'customer-id' } as PublicUserDto;

    controller.listAttempts('order-id', undefined, user);
    controller.listAwards('order-id', undefined, user);
    controller.play('attempt-id', undefined, user);

    expect(prizes.listAttemptsForOrder).toHaveBeenCalledWith(
      'order-id',
      undefined,
      user.id,
    );
    expect(prizes.listAwardsForOrder).toHaveBeenCalledWith(
      'order-id',
      undefined,
      user.id,
    );
    expect(prizes.playAttempt).toHaveBeenCalledWith(
      'attempt-id',
      undefined,
      user.id,
    );
  });
});
