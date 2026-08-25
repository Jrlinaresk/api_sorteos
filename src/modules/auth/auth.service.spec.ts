import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import { AuthService } from './auth.service';
import { UsersService } from '../users/users.service';
import { UserRole } from '../users/enums/user-role.enum';
import { UserDocument } from '../users/schemas/user.schema';
import { EmailVerificationService } from '../email/email-verification.service';
import { RefreshTokensService } from './refresh-tokens.service';
import { EmailVerificationPurpose } from '../email/enums/email-verification-purpose.enum';
import { Connection } from 'mongoose';

describe('AuthService', () => {
  const registrationId = 'A'.repeat(43);
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
    createPendingRegistration: jest.fn(),
    findPendingRegistrationByEmail: jest.fn(),
    activatePendingRegistrationByEmail: jest.fn(),
    findByPhoneForAuthentication: jest.fn(),
    replaceLegacyPassword: jest.fn(),
    recordFailedLogin: jest.fn(),
    clearFailedLogins: jest.fn(),
    findByPhone: jest.fn(),
    findOne: jest.fn(),
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
    (
      emailVerificationService.createVerificationCode as jest.Mock
    ).mockResolvedValue(undefined);
    (emailVerificationService.verifyCode as jest.Mock).mockResolvedValue(
      undefined,
    );
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

  it('no emite una sesión cliente para un rol privilegiado', async () => {
    const passwordHash = await bcrypt.hash('UnaClave9Segura', 4);
    const user = {
      _id: '507f1f77bcf86cd799439011',
      phone: '+5511999999999',
      passwordHash,
      role: UserRole.ADMIN,
      isActive: true,
    } as unknown as UserDocument;
    (usersService.findByPhoneForAuthentication as jest.Mock).mockResolvedValue(
      user,
    );

    await expect(
      service.login(
        { phone: user.phone, password: 'UnaClave9Segura' },
        UserRole.CUSTOMER,
      ),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(jwtService.signAsync).not.toHaveBeenCalled();
  });

  it('crea un alta pendiente y responde sin entregar tokens ni datos personales', async () => {
    const pending = {
      _id: '507f1f77bcf86cd799439011',
      phone: '+5511999999999',
      email: 'joao@example.com',
      registrationPending: true,
      isActive: false,
    } as unknown as UserDocument;
    (usersService.createPendingRegistration as jest.Mock).mockResolvedValue({
      registrationId,
      user: pending,
    });

    const result = await service.register({
      phone: '+5511999999999',
      password: 'UnaClave9Segura',
      name: 'João Silva',
      nickname: 'joao',
      cpf: '52998224725',
      email: 'joao@example.com',
    });

    expect(result).toEqual({
      registrationId,
      message:
        'Si los datos pueden registrarse, recibirás un código de verificación por correo',
      verificationRequired: true,
    });
    expect(result).not.toHaveProperty('accessToken');
    expect(result).not.toHaveProperty('user');
    expect(
      emailVerificationService.createVerificationCode,
    ).toHaveBeenCalledWith(
      'joao@example.com',
      EmailVerificationPurpose.Registration,
      registrationId,
    );
    expect(jwtService.signAsync).not.toHaveBeenCalled();
  });

  it('da la misma respuesta si la identidad ya existe y no envía código', async () => {
    (usersService.createPendingRegistration as jest.Mock).mockResolvedValue({
      registrationId,
      user: null,
    });

    const result = await service.register({
      phone: '+5511999999999',
      password: 'UnaClave9Segura',
      name: 'João Silva',
      nickname: 'joao',
      cpf: '52998224725',
      email: 'joao@example.com',
    });

    expect(result.verificationRequired).toBe(true);
    expect(result.registrationId).toBe(registrationId);
    expect(
      emailVerificationService.createVerificationCode,
    ).not.toHaveBeenCalled();
  });

  it('reenvía solo para el registrationId vigente y conserva respuesta opaca', async () => {
    const pending = {
      email: 'joao@example.com',
      registrationPending: true,
      isActive: false,
    } as unknown as UserDocument;
    (
      usersService.findPendingRegistrationByEmail as jest.Mock
    ).mockResolvedValue(pending);

    const result = await service.resendRegistrationCode({
      registrationId,
      email: 'JOAO@example.com',
    });

    expect(usersService.findPendingRegistrationByEmail).toHaveBeenCalledWith(
      'JOAO@example.com',
      registrationId,
    );
    expect(
      emailVerificationService.createVerificationCode,
    ).toHaveBeenCalledWith(
      'joao@example.com',
      EmailVerificationPurpose.Registration,
      registrationId,
    );
    expect(result.registrationId).toBe(registrationId);
  });

  it('confirma el correo, activa el alta y solo entonces entrega sesión', async () => {
    const activated = {
      _id: '507f1f77bcf86cd799439011',
      phone: '+5511999999999',
      email: 'joao@example.com',
      role: UserRole.CUSTOMER,
      registrationPending: false,
      emailVerified: true,
      isActive: true,
    } as unknown as UserDocument;
    (
      usersService.activatePendingRegistrationByEmail as jest.Mock
    ).mockResolvedValue(activated);

    const result = await service.confirmRegistration({
      registrationId,
      email: 'JOAO@example.com',
      code: '123456',
    });

    expect(emailVerificationService.verifyCode).toHaveBeenCalledWith(
      'joao@example.com',
      '123456',
      EmailVerificationPurpose.Registration,
      registrationId,
    );
    expect(
      usersService.activatePendingRegistrationByEmail,
    ).toHaveBeenCalledWith('joao@example.com', registrationId);
    expect(result.accessToken).toBe('signed.jwt.token');
  });

  it('consume el OTP y activa la cuenta dentro de la misma transacción', async () => {
    const activated = {
      _id: '507f1f77bcf86cd799439011',
      phone: '+5511999999999',
      email: 'joao@example.com',
      role: UserRole.CUSTOMER,
      registrationPending: false,
      emailVerified: true,
      isActive: true,
    } as unknown as UserDocument;
    const session = {
      withTransaction: jest.fn(async (operation: () => Promise<void>) =>
        operation(),
      ),
      endSession: jest.fn().mockResolvedValue(undefined),
    };
    const transactionalService = new AuthService(
      usersService,
      jwtService,
      configService,
      emailVerificationService,
      undefined,
      {
        startSession: jest.fn().mockResolvedValue(session),
      } as unknown as Connection,
    );
    (
      usersService.activatePendingRegistrationByEmail as jest.Mock
    ).mockResolvedValue(activated);

    await transactionalService.confirmRegistration({
      registrationId,
      email: 'joao@example.com',
      code: '123456',
    });

    expect(emailVerificationService.verifyCode).toHaveBeenCalledWith(
      'joao@example.com',
      '123456',
      EmailVerificationPurpose.Registration,
      registrationId,
      session,
    );
    expect(
      usersService.activatePendingRegistrationByEmail,
    ).toHaveBeenCalledWith('joao@example.com', registrationId, session);
    expect(session.withTransaction).toHaveBeenCalledTimes(1);
    expect(session.endSession).toHaveBeenCalledTimes(1);
  });

  it('no activa el alta cuando el código es inválido', async () => {
    (emailVerificationService.verifyCode as jest.Mock).mockRejectedValue(
      new BadRequestException('Código inválido'),
    );

    await expect(
      service.confirmRegistration({
        registrationId,
        email: 'joao@example.com',
        code: '123456',
      }),
    ).rejects.toMatchObject({
      message: 'Los datos o el código de verificación no son válidos',
    });
    expect(
      usersService.activatePendingRegistrationByEmail,
    ).not.toHaveBeenCalled();
    expect(jwtService.signAsync).not.toHaveBeenCalled();
  });

  it('un OTP anterior no crea sesión si otro intento sustituyó el registrationId', async () => {
    const currentRegistrationId = 'B'.repeat(43);
    (
      usersService.activatePendingRegistrationByEmail as jest.Mock
    ).mockImplementation(async (_email: string, candidateId: string) =>
      candidateId === currentRegistrationId
        ? ({
            _id: '507f1f77bcf86cd799439011',
            phone: '+5511999999999',
            role: UserRole.CUSTOMER,
            isActive: true,
            registrationPending: false,
          } as unknown as UserDocument)
        : null,
    );

    await expect(
      service.confirmRegistration({
        registrationId,
        email: 'joao@example.com',
        code: '111111',
      }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(jwtService.signAsync).not.toHaveBeenCalled();

    await expect(
      service.confirmRegistration({
        registrationId: currentRegistrationId,
        email: 'joao@example.com',
        code: '222222',
      }),
    ).resolves.toMatchObject({ accessToken: 'signed.jwt.token' });
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

  it('rechaza login de un alta pendiente aun con contraseña correcta', async () => {
    const user = {
      _id: '507f1f77bcf86cd799439011',
      phone: '+5511999999999',
      passwordHash: await bcrypt.hash('UnaClave9Segura', 4),
      role: UserRole.CUSTOMER,
      isActive: false,
      registrationPending: true,
    } as unknown as UserDocument;
    (usersService.findByPhoneForAuthentication as jest.Mock).mockResolvedValue(
      user,
    );

    await expect(
      service.login({ phone: user.phone, password: 'UnaClave9Segura' }),
    ).rejects.toMatchObject({ message: 'Teléfono o contraseña incorrectos' });
    expect(jwtService.signAsync).not.toHaveBeenCalled();
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
    ).toHaveBeenCalledWith(
      'joao@example.com',
      EmailVerificationPurpose.PasswordReset,
    );
  });

  it('no espera al SMTP al responder una solicitud de recuperación', async () => {
    const user = {
      _id: '507f1f77bcf86cd799439011',
      phone: '+5511999999999',
      email: 'joao@example.com',
    } as unknown as UserDocument;
    let finishDelivery: (() => void) | undefined;
    (usersService.findByPhone as jest.Mock).mockResolvedValue(user);
    (
      emailVerificationService.createVerificationCode as jest.Mock
    ).mockReturnValue(
      new Promise<void>((resolve) => {
        finishDelivery = resolve;
      }),
    );

    await expect(
      service.requestPasswordReset({
        phone: user.phone,
        email: user.email!,
      }),
    ).resolves.toBeUndefined();
    finishDelivery?.();
  });

  it('no usa recuperación de contraseña para activar un alta pendiente', async () => {
    const pending = {
      _id: '507f1f77bcf86cd799439011',
      phone: '+5511999999999',
      email: 'joao@example.com',
      isActive: false,
      registrationPending: true,
    } as unknown as UserDocument;
    (usersService.findByPhone as jest.Mock).mockResolvedValue(pending);

    await service.requestPasswordReset({
      phone: pending.phone,
      email: pending.email!,
    });

    expect(
      emailVerificationService.createVerificationCode,
    ).not.toHaveBeenCalled();
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
      EmailVerificationPurpose.PasswordReset,
    );
    expect(usersService.setPassword).toHaveBeenCalledWith(
      String(user._id),
      'OtraClave9Segura',
      true,
    );
    expect(result.accessToken).toBe('signed.jwt.token');
  });

  it('no permite que el reset web cliente cambie una cuenta privilegiada', async () => {
    const user = {
      _id: '507f1f77bcf86cd799439011',
      phone: '+5511999999999',
      email: 'admin@example.com',
      role: UserRole.ADMIN,
      isActive: true,
    } as unknown as UserDocument;
    (usersService.findByPhone as jest.Mock).mockResolvedValue(user);

    await expect(
      service.confirmPasswordReset(
        {
          phone: user.phone,
          email: user.email!,
          code: 'A1B2C3',
          newPassword: 'OtraClave9Segura',
        },
        UserRole.CUSTOMER,
      ),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(emailVerificationService.verifyCode).not.toHaveBeenCalled();
    expect(usersService.setPassword).not.toHaveBeenCalled();
  });

  it('rechaza un refresh emitido antes de cambiar la versión de seguridad', async () => {
    const refreshTokens = {
      rotate: jest.fn().mockResolvedValue({
        token: 'rotated-refresh',
        userId: '507f1f77bcf86cd799439011',
        expiresAt: new Date('2026-09-24T00:00:00.000Z'),
        authVersion: 2,
      }),
      revokeAllForUser: jest.fn().mockResolvedValue(undefined),
    } as unknown as RefreshTokensService;
    const refreshService = new AuthService(
      usersService,
      jwtService,
      configService,
      emailVerificationService,
      refreshTokens,
    );
    (usersService.findOne as jest.Mock).mockResolvedValue({
      _id: '507f1f77bcf86cd799439011',
      phone: '+5511999999999',
      role: UserRole.CUSTOMER,
      isActive: true,
      authVersion: 3,
    });

    await expect(refreshService.refresh('old-refresh')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(refreshTokens.revokeAllForUser).toHaveBeenCalledWith(
      '507f1f77bcf86cd799439011',
      'Versión de seguridad de la cuenta modificada',
    );
    expect(jwtService.signAsync).not.toHaveBeenCalled();
  });
});
