import { FirstAdminBootstrapService } from './first-admin-bootstrap.service';

function queryResult<T>(value: T) {
  const query = {
    session: jest.fn(),
    lean: jest.fn(),
    select: jest.fn(),
    exec: jest.fn().mockResolvedValue(value),
  };
  query.session.mockReturnValue(query);
  query.lean.mockReturnValue(query);
  query.select.mockReturnValue(query);
  return query;
}

describe('FirstAdminBootstrapService', () => {
  const variables: Record<string, string> = {
    BOOTSTRAP_ADMIN_NAME: 'Administración',
    BOOTSTRAP_ADMIN_PHONE: '+5511999999999',
    BOOTSTRAP_ADMIN_PASSWORD: 'Segura1234',
    BOOTSTRAP_ADMIN_EMAIL: 'admin@example.com',
  };
  let session: {
    withTransaction: jest.Mock;
    endSession: jest.Mock;
  };
  let connection: { startSession: jest.Mock };
  let usersService: { create: jest.Mock };
  let auditService: { tryRecord: jest.Mock };
  let userModel: { findOne: jest.Mock };
  let bootstrapStateModel: { findById: jest.Mock; create: jest.Mock };

  beforeEach(() => {
    session = {
      withTransaction: jest.fn(async (work: () => Promise<void>) => work()),
      endSession: jest.fn().mockResolvedValue(undefined),
    };
    connection = { startSession: jest.fn().mockResolvedValue(session) };
    usersService = { create: jest.fn() };
    auditService = { tryRecord: jest.fn().mockResolvedValue(undefined) };
    userModel = { findOne: jest.fn() };
    bootstrapStateModel = {
      findById: jest.fn(),
      create: jest.fn().mockResolvedValue([]),
    };
  });

  it('crea y audita el primer ADMIN dentro de una transacción', async () => {
    bootstrapStateModel.findById.mockReturnValue(queryResult(null));
    userModel.findOne.mockReturnValue(queryResult(null));
    const user = {
      _id: '507f1f77bcf86cd799439011',
      emailVerified: false,
      save: jest.fn().mockResolvedValue(undefined),
    };
    usersService.create.mockResolvedValue(user);

    const result = await service().run();

    expect(result).toEqual({ created: true, userId: user._id });
    expect(usersService.create).toHaveBeenCalledWith(
      expect.objectContaining({ role: 'admin', password: 'Segura1234' }),
      session,
    );
    expect(user.emailVerified).toBe(true);
    expect(user.save).toHaveBeenCalledWith({ session });
    expect(bootstrapStateModel.create).toHaveBeenCalledWith(
      [expect.objectContaining({ _id: 'first-admin', userId: user._id })],
      { session },
    );
    expect(auditService.tryRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'security.bootstrap.first_admin',
        resourceId: user._id,
      }),
    );
    expect(session.endSession).toHaveBeenCalled();
  });

  it('es idempotente y no vuelve a usar las credenciales tras el marcador', async () => {
    const userId = '507f1f77bcf86cd799439012';
    bootstrapStateModel.findById.mockReturnValue(queryResult({ userId }));
    userModel.findOne.mockReturnValue(queryResult({ _id: userId }));

    await expect(service().run()).resolves.toEqual({
      created: false,
      userId,
    });
    expect(usersService.create).not.toHaveBeenCalled();
    expect(bootstrapStateModel.create).not.toHaveBeenCalled();
    expect(auditService.tryRecord).not.toHaveBeenCalled();
  });

  it('registra como consumido un despliegue que ya tenía ADMIN', async () => {
    const userId = '507f1f77bcf86cd799439013';
    bootstrapStateModel.findById.mockReturnValue(queryResult(null));
    userModel.findOne.mockReturnValue(queryResult({ _id: userId }));

    await expect(service().run()).resolves.toEqual({
      created: false,
      userId,
    });
    expect(bootstrapStateModel.create).toHaveBeenCalledWith(
      [expect.objectContaining({ _id: 'first-admin', userId })],
      { session },
    );
    expect(usersService.create).not.toHaveBeenCalled();
  });

  it('falla cerrado si el marcador existe pero su ADMIN ya no está', async () => {
    bootstrapStateModel.findById.mockReturnValue(
      queryResult({ userId: '507f1f77bcf86cd799439014' }),
    );
    userModel.findOne.mockReturnValue(queryResult(null));

    await expect(service().run()).rejects.toThrow(
      'ya fue consumida y su cuenta no está disponible',
    );
    expect(usersService.create).not.toHaveBeenCalled();
    expect(session.endSession).toHaveBeenCalled();
  });

  it('valida las variables antes de abrir una transacción', async () => {
    const invalidConfig = {
      get: jest.fn((name: string) =>
        name === 'BOOTSTRAP_ADMIN_NAME' ? undefined : variables[name],
      ),
    };
    const instance = new FirstAdminBootstrapService(
      invalidConfig as any,
      usersService as any,
      auditService as any,
      connection as any,
      userModel as any,
      bootstrapStateModel as any,
    );

    await expect(instance.run()).rejects.toThrow(
      'BOOTSTRAP_ADMIN_NAME es obligatoria',
    );
    expect(connection.startSession).not.toHaveBeenCalled();
  });

  function service(): FirstAdminBootstrapService {
    return new FirstAdminBootstrapService(
      { get: jest.fn((name: string) => variables[name]) } as any,
      usersService as any,
      auditService as any,
      connection as any,
      userModel as any,
      bootstrapStateModel as any,
    );
  }
});
