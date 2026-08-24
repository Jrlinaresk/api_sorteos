import { Types } from 'mongoose';
import * as bcrypt from 'bcryptjs';
import { createHash } from 'crypto';
import { UsersService } from './users.service';
import { UserRole } from './enums/user-role.enum';

function query<T>(value: T | Promise<T>) {
  const chain: Record<string, jest.Mock> = {
    exec: jest.fn().mockImplementation(() => Promise.resolve(value)),
  };
  for (const method of ['select', 'lean', 'limit', 'session']) {
    chain[method] = jest.fn().mockReturnValue(chain);
  }
  return chain;
}

describe('UsersService pending registrations', () => {
  const identity = {
    phone: '+5511999999999',
    password: 'UnaClave9Segura',
    name: 'João Silva',
    nickname: 'joao',
    cpf: '52998224725',
    email: 'joao@example.com',
  };

  let model: Record<string, jest.Mock>;
  let service: UsersService;

  beforeEach(() => {
    model = {
      findOne: jest.fn().mockReturnValue(query(null)),
      find: jest.fn().mockReturnValue(query([])),
      create: jest.fn().mockImplementation(async (payload) => payload),
      deleteOne: jest
        .fn()
        .mockReturnValue(query({ acknowledged: true, deletedCount: 0 })),
      findOneAndUpdate: jest.fn().mockReturnValue(query(null)),
    };
    service = new UsersService(model as never);
  });

  it('guarda el registro público inactivo y con vencimiento', async () => {
    const created = await service.createPendingRegistration(identity);

    expect(created.registrationId).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(created.user).toEqual(
      expect.objectContaining({
        phone: '+5511999999999',
        cpf: '52998224725',
        email: 'joao@example.com',
        isActive: false,
        emailVerified: false,
        registrationPending: true,
        registrationPendingExpiresAt: expect.any(Date),
        role: UserRole.CUSTOMER,
        password: undefined,
        passwordHash: expect.stringMatching(/^\$2[aby]\$/),
        registrationIdHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
    );
    expect(created.user).not.toHaveProperty('registrationId');
    expect(
      (
        created.user as unknown as { registrationPendingExpiresAt: Date }
      ).registrationPendingExpiresAt.getTime(),
    ).toBeGreaterThan(Date.now() + 23 * 60 * 60 * 1000);
    expect(
      (created.user as unknown as { registrationIdHash: string })
        .registrationIdHash,
    ).toBe(createHash('sha256').update(created.registrationId).digest('hex'));
  });

  it('una repetición exacta reemplaza contraseña e intento anteriores', async () => {
    const attackerPassword = 'ClaveAtacante9Segura';
    const victimPassword = 'ClaveVictima9Segura';
    const existing = {
      _id: new Types.ObjectId(),
      phone: identity.phone,
      email: identity.email,
      cpf: identity.cpf,
      role: UserRole.CUSTOMER,
      isActive: false,
      registrationPending: true,
      registrationPendingExpiresAt: new Date(Date.now() + 60_000),
      passwordHash: await bcrypt.hash(attackerPassword, 4),
    };
    model.findOne.mockReturnValue(
      query({
        phone: identity.phone,
        email: identity.email,
        cpf: identity.cpf,
      }),
    );
    model.find.mockReturnValue(query([existing]));
    let replacement: Record<string, any> | undefined;
    model.findOneAndUpdate.mockImplementation(
      (_filter: unknown, update: Record<string, any>) => {
        replacement = update;
        return query({ ...existing, ...update.$set });
      },
    );

    const result = await service.createPendingRegistration({
      ...identity,
      password: victimPassword,
      name: 'Nombre Víctima',
      nickname: 'victima',
    });

    expect(result.user).toEqual(
      expect.objectContaining({ name: 'Nombre Víctima', nickname: 'victima' }),
    );
    expect(result.registrationId).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(
      await bcrypt.compare(victimPassword, replacement!.$set.passwordHash),
    ).toBe(true);
    expect(
      await bcrypt.compare(attackerPassword, replacement!.$set.passwordHash),
    ).toBe(false);
    expect(replacement!.$set.registrationIdHash).toBe(
      createHash('sha256').update(result.registrationId).digest('hex'),
    );
    expect(replacement!.$inc).toEqual({ authVersion: 1 });
    expect(model.create).not.toHaveBeenCalled();
    expect(model.deleteOne).not.toHaveBeenCalled();
  });

  it('no revela una colisión con una cuenta activa', async () => {
    const active = {
      _id: new Types.ObjectId(),
      phone: identity.phone,
      email: identity.email,
      cpf: identity.cpf,
      role: UserRole.CUSTOMER,
      isActive: true,
      registrationPending: false,
    };
    model.findOne.mockReturnValue(
      query({
        phone: identity.phone,
        email: identity.email,
        cpf: identity.cpf,
      }),
    );
    model.find.mockReturnValue(query([active]));

    const first = await service.createPendingRegistration(identity);
    const second = await service.createPendingRegistration(identity);

    expect(first.user).toBeNull();
    expect(second.user).toBeNull();
    expect(first.registrationId).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(second.registrationId).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(first.registrationId).not.toBe(second.registrationId);
    expect(model.deleteOne).not.toHaveBeenCalled();
  });

  it('solo el registrationId vigente activa la contraseña reemplazada', async () => {
    const staleRegistrationId = 'A'.repeat(43);
    const currentRegistrationId = 'B'.repeat(43);
    const currentHash = createHash('sha256')
      .update(currentRegistrationId)
      .digest('hex');
    const activated = {
      _id: new Types.ObjectId(),
      ...identity,
      isActive: true,
      registrationPending: false,
      emailVerified: true,
    };
    model.findOneAndUpdate.mockImplementation((filter) =>
      query(filter.registrationIdHash === currentHash ? activated : null),
    );

    await expect(
      service.activatePendingRegistrationByEmail(
        ' JOAO@example.com ',
        staleRegistrationId,
      ),
    ).resolves.toBeNull();
    await expect(
      service.activatePendingRegistrationByEmail(
        ' JOAO@example.com ',
        currentRegistrationId,
      ),
    ).resolves.toBe(activated);

    expect(model.findOneAndUpdate).toHaveBeenLastCalledWith(
      {
        email: 'joao@example.com',
        role: UserRole.CUSTOMER,
        isActive: false,
        registrationPending: true,
        registrationPendingExpiresAt: { $gt: expect.any(Date) },
        registrationIdHash: currentHash,
      },
      {
        $set: {
          isActive: true,
          emailVerified: true,
          registrationPending: false,
          failedLoginAttempts: 0,
        },
        $inc: { authVersion: 1 },
        $unset: {
          registrationPendingExpiresAt: 1,
          registrationIdHash: 1,
          lockedUntil: 1,
        },
      },
      { new: true },
    );
  });
});
