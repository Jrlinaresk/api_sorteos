import { Injectable, Optional, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { timingSafeEqual } from 'crypto';
import { UsersService } from '../users/users.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { AuthResponseDto } from './dto/auth-response.dto';
import { UserRole } from '../users/enums/user-role.enum';
import { UserDocument } from '../users/schemas/user.schema';
import { JwtPayload } from './interfaces/jwt-payload.interface';
import { EmailVerificationService } from '../email/email-verification.service';
import { RequestPasswordResetDto } from './dto/request-password-reset.dto';
import { ConfirmPasswordResetDto } from './dto/confirm-password-reset.dto';
import { normalizeEmail } from '../users/utils/user-normalization';
import { RefreshTokensService } from './refresh-tokens.service';

const DUMMY_PASSWORD_HASH = bcrypt.hashSync('invalid-password-placeholder', 12);

@Injectable()
export class AuthService {
  private readonly expiresIn: string;

  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
    configService: ConfigService,
    private readonly emailVerificationService: EmailVerificationService,
    @Optional() private readonly refreshTokens?: RefreshTokensService,
  ) {
    this.expiresIn =
      configService.get<string>('JWT_ACCESS_EXPIRES_IN') ?? '15m';
  }

  async register(dto: RegisterDto): Promise<AuthResponseDto> {
    const user = await this.usersService.create({
      phone: dto.phone,
      password: dto.password,
      name: dto.name,
      cpf: dto.cpf,
      email: dto.email,
      nickname: dto.nickname,
      role: UserRole.CUSTOMER,
    });
    return this.createSession(user);
  }

  async login(dto: LoginDto): Promise<AuthResponseDto> {
    const user = await this.usersService.findByPhoneForAuthentication(
      dto.phone,
    );

    if (!user) {
      await bcrypt.compare(dto.password, DUMMY_PASSWORD_HASH);
      throw this.invalidCredentials();
    }

    if (user.lockedUntil && user.lockedUntil.getTime() > Date.now()) {
      const timingHash =
        user.passwordHash ??
        (user.password?.startsWith('$2') ? user.password : DUMMY_PASSWORD_HASH);
      await bcrypt.compare(dto.password, timingHash);
      throw this.invalidCredentials();
    }

    const valid = await this.verifyPassword(user, dto.password);
    if (!valid) {
      await this.usersService.recordFailedLogin(String(user._id));
      throw this.invalidCredentials();
    }
    if (user.isActive === false) throw this.invalidCredentials();

    await this.usersService.clearFailedLogins(String(user._id));

    return this.createSession(user);
  }

  async requestPasswordReset(dto: RequestPasswordResetDto): Promise<void> {
    const email = normalizeEmail(dto.email);
    if (!email) return;

    try {
      const user = await this.usersService.findByPhone(dto.phone);
      if (normalizeEmail(user.email) === email) {
        // El envío se desacopla de la respuesta genérica: esperar al SMTP solo
        // cuando la cuenta existe permitiría enumerarla midiendo la latencia.
        void this.emailVerificationService
          .createVerificationCode(email)
          .catch(() => undefined);
      }
    } catch {
      // Respuesta deliberadamente idéntica para impedir enumerar cuentas.
    }
  }

  async confirmPasswordReset(
    dto: ConfirmPasswordResetDto,
  ): Promise<AuthResponseDto> {
    const email = normalizeEmail(dto.email);
    if (!email) throw this.invalidResetCode();

    let user: UserDocument;
    try {
      user = await this.usersService.findByPhone(dto.phone);
    } catch {
      throw this.invalidResetCode();
    }

    if (normalizeEmail(user.email) !== email) throw this.invalidResetCode();

    try {
      await this.emailVerificationService.verifyCode(
        email,
        dto.code.toUpperCase(),
      );
    } catch {
      throw this.invalidResetCode();
    }

    const updated = await this.usersService.setPassword(
      String(user._id),
      dto.newPassword,
      true,
    );
    await this.refreshTokens?.revokeAllForUser(
      String(user._id),
      'Contraseña restablecida',
    );
    return this.createSession(updated);
  }

  async refresh(refreshToken: string): Promise<AuthResponseDto> {
    if (!this.refreshTokens) throw this.invalidCredentials();
    const rotated = await this.refreshTokens.rotate(refreshToken);
    const user = await this.usersService.findOne(rotated.userId);
    if (
      user.isActive === false ||
      (user.authVersion ?? 0) !== rotated.authVersion
    ) {
      await this.refreshTokens.revokeAllForUser(
        rotated.userId,
        'Versión de seguridad de la cuenta modificada',
      );
      throw this.invalidCredentials();
    }
    return this.createSession(user, rotated);
  }

  async logout(refreshToken: string): Promise<void> {
    await this.refreshTokens?.revoke(refreshToken);
  }

  async changePassword(
    userId: string,
    currentPassword: string,
    newPassword: string,
  ): Promise<AuthResponseDto> {
    const publicUser = await this.usersService.findOne(userId);
    const user = await this.usersService.findByPhoneForAuthentication(
      publicUser.phone,
    );
    if (!user || !(await this.verifyPassword(user, currentPassword))) {
      throw this.invalidCredentials();
    }
    const updated = await this.usersService.setPassword(userId, newPassword);
    await this.refreshTokens?.revokeAllForUser(
      userId,
      'Contraseña cambiada por el usuario',
    );
    return this.createSession(updated);
  }

  private async verifyPassword(
    user: UserDocument,
    plainPassword: string,
  ): Promise<boolean> {
    if (user.passwordHash) {
      return bcrypt.compare(plainPassword, user.passwordHash);
    }

    if (!user.password) {
      await bcrypt.compare(plainPassword, DUMMY_PASSWORD_HASH);
      return false;
    }

    const legacyValid = user.password.startsWith('$2')
      ? await bcrypt.compare(plainPassword, user.password)
      : this.constantTimeTextComparison(plainPassword, user.password);

    if (legacyValid) {
      // Migración de una sola vez: incluso un hash bcrypt heredado se vuelve a
      // generar con el coste actual y el campo anterior se elimina.
      const migrated = await this.usersService.replaceLegacyPassword(
        String(user._id),
        plainPassword,
      );
      user.authVersion = migrated.authVersion;
    }
    return legacyValid;
  }

  private constantTimeTextComparison(
    candidate: string,
    stored: string,
  ): boolean {
    const candidateBuffer = Buffer.from(candidate);
    const storedBuffer = Buffer.from(stored);
    if (candidateBuffer.length !== storedBuffer.length) return false;
    return timingSafeEqual(candidateBuffer, storedBuffer);
  }

  private async createSession(
    user: UserDocument,
    existingRefresh?: { token: string; expiresAt: Date },
  ): Promise<AuthResponseDto> {
    const payload: JwtPayload = {
      sub: String(user._id),
      phone: user.phone,
      role: user.role ?? UserRole.CUSTOMER,
      ver: user.authVersion ?? 0,
    };
    const refresh =
      existingRefresh ||
      (this.refreshTokens
        ? await this.refreshTokens.issue(
            String(user._id),
            undefined,
            user.authVersion ?? 0,
          )
        : { token: '', expiresAt: new Date(0) });
    return {
      accessToken: await this.jwtService.signAsync(payload),
      refreshToken: refresh.token,
      refreshTokenExpiresAt: refresh.expiresAt,
      tokenType: 'Bearer',
      expiresIn: this.expiresIn,
      user: this.usersService.toPublicUser(user),
    };
  }

  private invalidCredentials(): UnauthorizedException {
    return new UnauthorizedException('Teléfono o contraseña incorrectos');
  }

  private invalidResetCode(): UnauthorizedException {
    return new UnauthorizedException(
      'Los datos o el código de recuperación no son válidos',
    );
  }
}
