import { UsersService } from './users.service';
import { UserRole } from './enums/user-role.enum';

describe('UsersService security', () => {
  const duplicateQuery = {
    select: jest.fn(),
    lean: jest.fn(),
    exec: jest.fn(),
  };
  duplicateQuery.select.mockReturnValue(duplicateQuery);
  duplicateQuery.lean.mockReturnValue(duplicateQuery);
  const updateQuery = {
    exec: jest.fn(),
  };

  const userModel = {
    findOne: jest.fn().mockReturnValue(duplicateQuery),
    create: jest.fn(),
    findByIdAndUpdate: jest.fn().mockReturnValue(updateQuery),
  };
  const service = new UsersService(userModel as never);

  beforeEach(() => {
    jest.clearAllMocks();
    duplicateQuery.select.mockReturnValue(duplicateQuery);
    duplicateQuery.lean.mockReturnValue(duplicateQuery);
    duplicateQuery.exec.mockResolvedValue(null);
    updateQuery.exec.mockResolvedValue({
      _id: '507f1f77bcf86cd799439011',
      isActive: false,
    });
  });

  it('guarda un hash bcrypt y nunca la contraseña recibida', async () => {
    userModel.create.mockImplementation(async (value) => value);

    await service.create({
      phone: '(11) 99999-9999',
      nickname: 'joao',
      password: 'UnaClave9Segura',
    });

    expect(userModel.create).toHaveBeenCalledWith(
      expect.objectContaining({
        phone: '+5511999999999',
        password: undefined,
        passwordHash: expect.stringMatching(/^\$2[aby]\$/),
        role: UserRole.CUSTOMER,
      }),
    );
    expect(userModel.create.mock.calls[0][0].passwordHash).not.toContain(
      'UnaClave9Segura',
    );
  });

  it('elimina credenciales de una respuesta pública', () => {
    const publicUser = service.toPublicUser({
      toObject: () => ({
        _id: '507f1f77bcf86cd799439011',
        phone: '+5511999999999',
        nickname: 'joao',
        password: 'legacy',
        passwordHash: 'hash',
        registrationIdHash: 'attempt-hash',
      }),
    } as never);

    expect(publicUser.id).toBe('507f1f77bcf86cd799439011');
    expect(publicUser).not.toHaveProperty('password');
    expect(publicUser).not.toHaveProperty('passwordHash');
    expect(publicUser).not.toHaveProperty('registrationIdHash');
    expect(publicUser.role).toBe(UserRole.CUSTOMER);
    expect(publicUser.isActive).toBe(true);
  });

  it('incrementa authVersion al desactivar o reactivar una cuenta', async () => {
    await service.update('507f1f77bcf86cd799439011', { isActive: false });

    expect(userModel.findByIdAndUpdate).toHaveBeenCalledWith(
      '507f1f77bcf86cd799439011',
      {
        $set: { isActive: false },
        $inc: { authVersion: 1 },
      },
      { new: true, runValidators: true },
    );
  });
});
