import { GUARDS_METADATA } from '@nestjs/common/constants';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { ROLES_KEY } from '../auth/decorators/roles.decorator';
import { UserRole } from '../users/enums/user-role.enum';
import { AuditController } from './audit.controller';

describe('AuditController security metadata', () => {
  it('exige JWT y rol ADMIN en todo el controlador', () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, AuditController)).toEqual(
      expect.arrayContaining([JwtAuthGuard, RolesGuard]),
    );
    expect(Reflect.getMetadata(ROLES_KEY, AuditController)).toEqual([
      UserRole.ADMIN,
    ]);
  });
});
