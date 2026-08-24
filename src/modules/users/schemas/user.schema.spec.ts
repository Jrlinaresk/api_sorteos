import { UserRole } from '../enums/user-role.enum';
import { UserSchema } from './user.schema';

describe('UserSchema security', () => {
  it('no selecciona credenciales por defecto', () => {
    expect(UserSchema.path('passwordHash').options.select).toBe(false);
    expect(UserSchema.path('password').options.select).toBe(false);
    expect(UserSchema.path('failedLoginAttempts').options.select).toBe(false);
    expect(UserSchema.path('lockedUntil').options.select).toBe(false);
  });

  it('define un rol seguro y una cuenta activa por defecto', () => {
    expect(UserSchema.path('role').options.default).toBe(UserRole.CUSTOMER);
    expect(UserSchema.path('isActive').options.default).toBe(true);
  });

  it('elimina credenciales durante la serialización', () => {
    const transform = UserSchema.get('toJSON')?.transform;
    expect(typeof transform).toBe('function');
    if (typeof transform !== 'function') {
      throw new Error('Falta el transformador seguro del usuario');
    }
    const serialized = transform(
      {} as never,
      {
        phone: '+5511999999999',
        nickname: 'joao',
        password: 'legacy',
        passwordHash: 'hash',
        failedLoginAttempts: 4,
        lockedUntil: new Date(),
        __v: 1,
      } as never,
      {} as never,
    );

    expect(serialized).not.toHaveProperty('password');
    expect(serialized).not.toHaveProperty('passwordHash');
    expect(serialized).not.toHaveProperty('failedLoginAttempts');
    expect(serialized).not.toHaveProperty('lockedUntil');
    expect(serialized).not.toHaveProperty('__v');
  });
});
