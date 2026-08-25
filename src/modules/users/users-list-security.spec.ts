import { ROLES_KEY } from '../auth/decorators/roles.decorator';
import { ListUsersDto } from './dto/list-users.dto';
import { UserRole } from './enums/user-role.enum';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

function queryResult<T>(value: T) {
  const query = {
    sort: jest.fn(),
    skip: jest.fn(),
    limit: jest.fn(),
    exec: jest.fn().mockResolvedValue(value),
  };
  query.sort.mockReturnValue(query);
  query.skip.mockReturnValue(query);
  query.limit.mockReturnValue(query);
  return query;
}

describe('Users administrative listing', () => {
  it('pagina la colección con un límite acotado', async () => {
    const rows = [{ _id: 'user-1' }];
    const findQuery = queryResult(rows);
    const countQuery = queryResult(201);
    const model = {
      find: jest.fn().mockReturnValue(findQuery),
      countDocuments: jest.fn().mockReturnValue(countQuery),
    };
    const service = new UsersService(model as never);

    await expect(
      service.findAll({ page: 3, limit: 100 } as ListUsersDto),
    ).resolves.toEqual({
      data: rows,
      meta: { page: 3, limit: 100, total: 201, pages: 3 },
    });
    expect(findQuery.skip).toHaveBeenCalledWith(200);
    expect(findQuery.limit).toHaveBeenCalledWith(100);
  });

  it('reserva listado y búsquedas de PII exclusivamente a ADMIN', () => {
    for (const method of ['findAll', 'findByPhone', 'findOne'] as const) {
      expect(
        Reflect.getMetadata(ROLES_KEY, UsersController.prototype[method]),
      ).toEqual([UserRole.ADMIN]);
    }
  });

  it('propaga el actor autenticado en cambios y eliminaciones', async () => {
    const targetId = '507f1f77bcf86cd799439011';
    const actor = {
      id: '507f1f77bcf86cd799439012',
      role: UserRole.ADMIN,
    };
    const updated = { _id: targetId };
    const users = {
      update: jest.fn().mockResolvedValue(updated),
      remove: jest.fn().mockResolvedValue(undefined),
      toPublicUser: jest.fn().mockReturnValue({ id: targetId }),
    };
    const controller = new UsersController(users as never);

    await controller.update(
      targetId,
      { role: UserRole.OPERATOR },
      actor as never,
    );
    await controller.remove(targetId, actor as never);

    expect(users.update).toHaveBeenCalledWith(
      targetId,
      { role: UserRole.OPERATOR },
      actor.id,
    );
    expect(users.remove).toHaveBeenCalledWith(targetId, actor.id);
  });
});
