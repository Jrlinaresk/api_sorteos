import { ROLES_KEY } from '../auth/decorators/roles.decorator';
import { UserRole } from '../users/enums/user-role.enum';
import { AdminDrawsController } from './admin-draws.controller';

describe('AdminDrawsController authorization', () => {
  it.each(['verifyManual', 'publish'] as const)(
    'reserva %s exclusivamente para ADMIN',
    (method) => {
      expect(
        Reflect.getMetadata(ROLES_KEY, AdminDrawsController.prototype[method]),
      ).toEqual([UserRole.ADMIN]);
    },
  );
});
