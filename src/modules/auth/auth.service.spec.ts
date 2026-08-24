import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { UnauthorizedException } from '@nestjs/common';
import { AuthService } from './auth.service';
import { UsersService } from '../users/users.service';
import { UserRole } from '../users/enums/user-role.enum';
import { UserDocument } from '../users/schemas/user.schema';
import { EmailVerificationService } from '../email/email-verification.service';

describe('AuthService', () => {
  const publicUser = {
    id: '507f1f77bcf86cd799439011',
    phone: '+5511999999999',
    nickname: 'joao',
    role: UserRole.CUSTOMER,
    isActive: true,
    emailVerified: false,
    balance: 0,
    participations: [],
  };
  const usersService = {
    create: jest.fn(),
    findByPhoneForAuthentication: jest.fn(),
    replaceLegacyPassword: jest.fn(),
    recordFailedLogin: jest.fn(),
    clearFailedLogins: jest.fn(),
    findByPhone: jest.fn(),
    setPassword: jest.fn(),
    toPublicUser: jest.fn().mockReturnValue(publicUser),
  } as unknown as UsersService;
  const jwtService = {
    signAsync: jest.fn().mockResolvedValue('signed.jwt.token'),
  } as unknown as JwtService;
  const configService = {
    get: jest.fn().mockReturnValue('15m'),
  } as unknown as ConfigService;
  const emailVerificationService = {
    createVerificationCode: jest.fn(),
    verifyCode: jest.fn(),
  } as unknown as EmailVerificationService;
  let service: AuthService;

  beforeEach(() => {
    jest.clearAllMocks();
    (usersService.toPublicUser as jest.Mock).mockReturnValue(publicUser);
    (jwtService.signAsync as jest.Mock).mockResolvedValue('signed.jwt.token');
    service = new AuthService(
      usersService,
      jwtService,
      configService,
      emailVerificationService,
    );
  });

  it('emite un JWT cuando la contraseña coincide', async () => {
    const passwordHash = await bcrypt.hash('UnaClave9Segura', 4);
    const user = {
      _id: '507f1f77bcf86cd799439011',
      phone: '+5511999999999',
      passwordHash,
      role: UserRole.CUSTOMER,
      isActive: true,
    } as unknown as UserDocument;
    (usersService.findByPhoneForAuthentication as jest.Mock).mockResolvedValue(
      user,
    );

    const result = await service.login({
      phone: user.phone,
      password: 'UnaClave9Segura',
    });

    expect(result.accessToken).toBe('signed.jwt.token');
    expect(result.user).toEqual(publicUser);
    expect(result.user).not.toHaveProperty('passwordHash');
    expect(jwtService.signAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        sub: String(user._id),
        role: UserRole.CUSTOMER,
      }),
    );
  });

  it('usa un error genérico cuando el usuario no existe', async () => {
    (usersService.findByPhoneForAuthentication as jest.Mock).mockResolvedValue(
      null,
    );
    await expect(
      service.login({
        phone: '+5511999999999',
        password: 'UnaClave9Segura',
      }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('registra un intento fallido sin revelar si la contraseña fue el problema', async () => {
    const user = {
      _id: '507f1f77bcf86cd799439011',
      phone: '+5511999999999',
      passwordHash: await bcrypt.hash('UnaClave9Segura', 4),
      role: UserRole.CUSTOMER,
      isActive: true,
    } as unknown as UserDocument;
    (usersService.findByPhoneForAuthentication as jest.Mock).mockResolvedValue(
      user,
    );

    await expect(
      service.login({ phone: user.phone, password: 'ClaveErrada9' }),
    ).rejects.toMatchObject({
      message: 'Teléfono o contraseña incorrectos',
    });
    expect(usersService.recordFailedLogin).toHaveBeenCalledWith(
      String(user._id),
    );
  });

  it('migra una contraseña heredada después de validarla', async () => {
    const user = {
      _id: '507f1f77bcf86cd799439011',
      phone: '+5511999999999',
      password: 'UnaClave9Segura',
      role: UserRole.CUSTOMER,
      isActive: true,
    } as unknown as UserDocument;
    (usersService.findByPhoneForAuthentication as jest.Mock).mockResolvedValue(
      user,
    );
    (usersService.replaceLegacyPassword as jest.Mock).mockResolvedValue({
      ...user,
      authVersion: 1,
    });

    await service.login({
      phone: user.phone,
      password: 'UnaClave9Segura',
    });

    expect(usersService.replaceLegacyPassword).toHaveBeenCalledWith(
      String(user._id),
      'UnaClave9Segura',
    );
  });

  it('envía recuperación solo cuando teléfono y correo coinciden', async () => {
    const user = {
      _id: '507f1f77bcf86cd799439011',
      phone: '+5511999999999',
      email: 'joao@example.com',
    } as unknown as UserDocument;
    (usersService.findByPhone as jest.Mock).mockResolvedValue(user);

    await service.requestPasswordReset({
      phone: user.phone,
      email: 'JOAO@example.com',
    });

    expect(
      emailVerificationService.createVerificationCode,
    ).toHaveBeenCalledWith('joao@example.com');
  });

  it('consume el código, cambia el hash y entrega una sesión nueva', async () => {
    const user = {
      _id: '507f1f77bcf86cd799439011',
      phone: '+5511999999999',
      email: 'joao@example.com',
      role: UserRole.CUSTOMER,
      isActive: true,
    } as unknown as UserDocument;
    (usersService.findByPhone as jest.Mock).mockResolvedValue(user);
    (usersService.setPassword as jest.Mock).mockResolvedValue(user);

    const result = await service.confirmPasswordReset({
      phone: user.phone,
      email: user.email!,
      code: 'a1b2c3',
      newPassword: 'OtraClave9Segura',
    });

    expect(emailVerificationService.verifyCode).toHaveBeenCalledWith(
      'joao@example.com',
      'A1B2C3',
    );
    expect(usersService.setPassword).toHaveBeenCalledWith(
      String(user._id),
      'OtraClave9Segura',
      true,
    );
    expect(result.accessToken).toBe('signed.jwt.token');
  });
});
