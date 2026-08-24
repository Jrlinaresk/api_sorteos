import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Types } from 'mongoose';
import { UsersService } from '../../users/users.service';
import { UserRole } from '../../users/enums/user-role.enum';
import { JwtStrategy } from './jwt.strategy';

describe('JwtStrategy pending registration guard', () => {
  const users = {
    findOneOrNull: jest.fn(),
    toPublicUser: jest.fn(),
  } as unknown as UsersService;
  const config = {
    get: jest.fn((name: string) =>
      name === 'JWT_SECRET'
        ? 'jwt-test-secret-with-at-least-32-characters'
        : undefined,
    ),
  } as unknown as ConfigService;

  beforeEach(() => jest.clearAllMocks());

  it('rechaza un JWT aunque sea válido si el alta sigue pendiente', async () => {
    const id = new Types.ObjectId();
    (users.findOneOrNull as jest.Mock).mockResolvedValue({
      _id: id,
      phone: '+5511999999999',
      role: UserRole.CUSTOMER,
      isActive: false,
      registrationPending: true,
      authVersion: 0,
    });
    const strategy = new JwtStrategy(config, users);

    await expect(
      strategy.validate({
        sub: id.toString(),
        phone: '+5511999999999',
        role: UserRole.CUSTOMER,
        ver: 0,
      }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(users.toPublicUser).not.toHaveBeenCalled();
  });
});
