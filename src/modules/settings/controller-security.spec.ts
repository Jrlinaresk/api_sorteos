import { GUARDS_METADATA } from '@nestjs/common/constants';
import { ROLES_KEY } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { UserRole } from '../users/enums/user-role.enum';
import { SettingsAdminController } from './settings-admin.controller';

describe('SettingsAdminController security metadata', () => {
  it('exige JWT en todas las rutas administrativas', () => {
    expect(
      Reflect.getMetadata(GUARDS_METADATA, SettingsAdminController),
    ).toEqual(expect.arrayContaining([JwtAuthGuard, RolesGuard]));
  });

  it.each(['create', 'update', 'publish', 'archive'] as const)(
    'reserva %s para admin',
    (method) => {
      expect(
        Reflect.getMetadata(
          ROLES_KEY,
          SettingsAdminController.prototype[method],
        ),
      ).toEqual([UserRole.ADMIN]);
    },
  );

  it.each(['list', 'getVersion'] as const)(
    'permite lectura %s a admin/operator',
    (method) => {
      expect(
        Reflect.getMetadata(
          ROLES_KEY,
          SettingsAdminController.prototype[method],
        ),
      ).toEqual([UserRole.ADMIN, UserRole.OPERATOR]);
    },
  );
});
