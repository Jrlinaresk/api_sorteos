import { ConflictException, ForbiddenException } from '@nestjs/common';
import { UsersService } from './users.service';
import { UserRole } from './enums/user-role.enum';

describe('UsersService security', () => {
  const targetId = '507f1f77bcf86cd799439011';
  const actorId = '507f1f77bcf86cd799439012';
  const duplicateQuery = {
    select: jest.fn(),
    lean: jest.fn(),
    sort: jest.fn(),
    session: jest.fn(),
    exec: jest.fn(),
  };
  duplicateQuery.select.mockReturnValue(duplicateQuery);
  duplicateQuery.lean.mockReturnValue(duplicateQuery);
  duplicateQuery.sort.mockReturnValue(duplicateQuery);
  duplicateQuery.session.mockReturnValue(duplicateQuery);
  const updateQuery = {
    exec: jest.fn(),
  };
  const findByIdQuery = {
    session: jest.fn(),
    exec: jest.fn(),
  };
  findByIdQuery.session.mockReturnValue(findByIdQuery);
  const countQuery = {
    session: jest.fn(),
    exec: jest.fn(),
  };
  countQuery.session.mockReturnValue(countQuery);
  const lockUpdateQuery = { exec: jest.fn() };
  const transactionSession = {
    withTransaction: jest.fn(),
    endSession: jest.fn(),
  };
  const database = { startSession: jest.fn() };

  const userModel = {
    findOne: jest.fn().mockReturnValue(duplicateQuery),
    create: jest.fn(),
    findById: jest.fn().mockReturnValue(findByIdQuery),
    findByIdAndUpdate: jest.fn().mockReturnValue(updateQuery),
    countDocuments: jest.fn().mockReturnValue(countQuery),
    updateOne: jest.fn().mockReturnValue(lockUpdateQuery),
    db: undefined as typeof database | undefined,
  };
  const service = new UsersService(userModel as never);

  beforeEach(() => {
    jest.clearAllMocks();
    duplicateQuery.select.mockReturnValue(duplicateQuery);
    duplicateQuery.lean.mockReturnValue(duplicateQuery);
    duplicateQuery.sort.mockReturnValue(duplicateQuery);
    duplicateQuery.session.mockReturnValue(duplicateQuery);
    duplicateQuery.exec.mockResolvedValue(null);
    updateQuery.exec.mockResolvedValue({
      _id: targetId,
      isActive: false,
    });
    findByIdQuery.session.mockReturnValue(findByIdQuery);
    findByIdQuery.exec.mockResolvedValue({
      _id: targetId,
      role: UserRole.CUSTOMER,
      isActive: true,
    });
    countQuery.session.mockReturnValue(countQuery);
    countQuery.exec.mockResolvedValue(2);
    lockUpdateQuery.exec.mockResolvedValue({ matchedCount: 1 });
    transactionSession.withTransaction.mockImplementation(
      async (callback: () => Promise<void>) => callback(),
    );
    transactionSession.endSession.mockResolvedValue(undefined);
    database.startSession.mockResolvedValue(transactionSession);
    userModel.db = undefined;
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
    await service.update(targetId, { isActive: false });

    expect(userModel.findByIdAndUpdate).toHaveBeenCalledWith(
      targetId,
      {
        $set: { isActive: false },
        $inc: { authVersion: 1 },
      },
      { new: true, runValidators: true },
    );
  });

  it.each([
    { change: { isActive: false }, action: 'desactivarse' },
    { change: { role: UserRole.OPERATOR }, action: 'degradarse' },
  ] as const)('impide a un admin $action', async ({ change }) => {
    await expect(
      service.update(targetId, change, targetId),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(userModel.findByIdAndUpdate).not.toHaveBeenCalled();
  });

  it('impide a un admin eliminarse a sí mismo', async () => {
    await expect(service.remove(targetId, targetId)).rejects.toBeInstanceOf(
      ForbiddenException,
    );

    expect(userModel.findById).not.toHaveBeenCalled();
    expect(userModel.findByIdAndUpdate).not.toHaveBeenCalled();
  });

  it.each([
    { change: { isActive: false }, action: 'desactivar' },
    { change: { role: UserRole.OPERATOR }, action: 'degradar' },
  ] as const)(
    'impide $action al último administrador activo',
    async ({ change }) => {
      findByIdQuery.exec.mockResolvedValue({
        _id: targetId,
        role: UserRole.ADMIN,
        isActive: true,
      });
      countQuery.exec.mockResolvedValue(1);

      await expect(
        service.update(targetId, change, actorId),
      ).rejects.toBeInstanceOf(ConflictException);

      expect(userModel.countDocuments).toHaveBeenCalledWith({
        role: UserRole.ADMIN,
        isActive: { $ne: false },
      });
      expect(userModel.findByIdAndUpdate).not.toHaveBeenCalled();
    },
  );

  it('impide eliminar al último administrador activo', async () => {
    findByIdQuery.exec.mockResolvedValue({
      _id: targetId,
      role: UserRole.ADMIN,
      isActive: true,
    });
    countQuery.exec.mockResolvedValue(1);

    await expect(service.remove(targetId, actorId)).rejects.toBeInstanceOf(
      ConflictException,
    );

    expect(userModel.findByIdAndUpdate).not.toHaveBeenCalled();
  });

  it('permite retirar un admin activo cuando queda otro', async () => {
    findByIdQuery.exec.mockResolvedValue({
      _id: targetId,
      role: UserRole.ADMIN,
      isActive: true,
    });
    countQuery.exec.mockResolvedValue(2);

    await expect(
      service.update(targetId, { role: UserRole.OPERATOR }, actorId),
    ).resolves.toEqual(expect.objectContaining({ _id: targetId }));

    expect(userModel.findByIdAndUpdate).toHaveBeenCalled();
  });

  it('serializa en una transacción las retiradas de administradores activos', async () => {
    userModel.db = database;
    findByIdQuery.exec.mockResolvedValue({
      _id: targetId,
      role: UserRole.ADMIN,
      isActive: true,
    });
    duplicateQuery.exec.mockResolvedValue({ _id: actorId });

    await service.update(targetId, { role: UserRole.OPERATOR }, actorId);

    expect(transactionSession.withTransaction).toHaveBeenCalledTimes(1);
    expect(userModel.updateOne).toHaveBeenCalledWith(
      {
        _id: actorId,
        role: UserRole.ADMIN,
        isActive: { $ne: false },
      },
      { $inc: { adminInvariantVersion: 1 } },
      { session: transactionSession },
    );
    expect(userModel.findByIdAndUpdate).toHaveBeenCalledWith(
      targetId,
      { $set: { role: UserRole.OPERATOR } },
      {
        new: true,
        runValidators: true,
        session: transactionSession,
      },
    );
    expect(transactionSession.endSession).toHaveBeenCalledTimes(1);
  });

  it('exige un actor para retirar una cuenta del conjunto de admins activos', async () => {
    findByIdQuery.exec.mockResolvedValue({
      _id: targetId,
      role: UserRole.ADMIN,
      isActive: true,
    });

    await expect(
      service.update(targetId, { isActive: false }),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(userModel.countDocuments).not.toHaveBeenCalled();
  });
});
