import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Throttle } from '@nestjs/throttler';
import {
  ApiAcceptedResponse,
  ApiBearerAuth,
  ApiHeader,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import type { CookieOptions, Request, Response } from 'express';
import { AuthService } from '../auth/auth.service';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { ChangePasswordDto } from '../auth/dto/change-password.dto';
import { ConfirmPasswordResetDto } from '../auth/dto/confirm-password-reset.dto';
import { ConfirmRegistrationDto } from '../auth/dto/confirm-registration.dto';
import { LoginDto } from '../auth/dto/login.dto';
import { RegisterDto } from '../auth/dto/register.dto';
import { RegistrationAcceptedDto } from '../auth/dto/registration-accepted.dto';
import { RequestPasswordResetDto } from '../auth/dto/request-password-reset.dto';
import { ResendRegistrationCodeDto } from '../auth/dto/resend-registration-code.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { PublicUserDto } from '../users/dto/public-user.dto';
import { UserRole } from '../users/enums/user-role.enum';
import {
  CLIENT_SESSION_HEADER,
  CLIENT_SESSION_HEADER_VALUE,
  ClientSessionCsrfGuard,
} from './client-session-csrf.guard';

const CLIENT_REFRESH_COOKIE = 'sorteos_client_refresh';
const CLIENT_SESSION_PATH = '/api/v1/client/session';

interface ClientSessionResponse {
  accessToken: string;
  tokenType: 'Bearer';
  expiresIn: string;
  user: PublicUserDto;
}

@ApiTags('Client web session')
@ApiHeader({
  name: CLIENT_SESSION_HEADER,
  required: false,
  description: `Obligatorio en mutaciones; valor: ${CLIENT_SESSION_HEADER_VALUE}`,
})
@UseGuards(ClientSessionCsrfGuard)
@Controller('client/session')
export class ClientSessionController {
  constructor(
    private readonly auth: AuthService,
    private readonly config: ConfigService,
  ) {}

  @Post('register')
  @HttpCode(HttpStatus.ACCEPTED)
  @Throttle({ default: { limit: 5, ttl: 60 * 60_000 } })
  @ApiAcceptedResponse({ type: RegistrationAcceptedDto })
  register(@Body() dto: RegisterDto): Promise<RegistrationAcceptedDto> {
    return this.auth.register(dto);
  }

  @Post('register/resend')
  @HttpCode(HttpStatus.ACCEPTED)
  @Throttle({ default: { limit: 5, ttl: 60 * 60_000 } })
  @ApiAcceptedResponse({ type: RegistrationAcceptedDto })
  resendRegistrationCode(
    @Body() dto: ResendRegistrationCodeDto,
  ): Promise<RegistrationAcceptedDto> {
    return this.auth.resendRegistrationCode(dto);
  }

  @Post('register/confirm')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 5, ttl: 15 * 60_000 } })
  @ApiOkResponse({ description: 'Access token; refresh solo en cookie' })
  async confirmRegistration(
    @Body() dto: ConfirmRegistrationDto,
    @Res({ passthrough: true }) response: Response,
  ): Promise<ClientSessionResponse> {
    return this.persistCustomerSession(
      await this.auth.confirmRegistration(dto),
      response,
    );
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @Throttle({
    default: { limit: 10, ttl: 60_000, blockDuration: 5 * 60_000 },
  })
  @ApiOperation({ summary: 'Inicia una sesión exclusiva para un cliente' })
  async login(
    @Body() dto: LoginDto,
    @Res({ passthrough: true }) response: Response,
  ): Promise<ClientSessionResponse> {
    return this.persistCustomerSession(
      await this.auth.login(dto, UserRole.CUSTOMER),
      response,
    );
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 30, ttl: 60_000, blockDuration: 60_000 } })
  @ApiOperation({ summary: 'Rota la cookie HttpOnly de la sesión cliente' })
  async refresh(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<ClientSessionResponse> {
    const refreshToken = this.readRefreshCookie(request);
    if (!refreshToken) {
      throw new UnauthorizedException('Sesión de cliente ausente');
    }
    return this.persistCustomerSession(
      await this.auth.refresh(refreshToken, UserRole.CUSTOMER),
      response,
    );
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @ApiOperation({ summary: 'Revoca y elimina la sesión de cliente' })
  async logout(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    const refreshToken = this.readRefreshCookie(request);
    if (refreshToken) {
      // No se puede confirmar el cierre si la revocación persistente falla.
      // Mantener la cookie permite reintentar sin comunicar un falso éxito.
      await this.auth.logout(refreshToken);
    }
    this.clearRefreshCookie(response);
  }

  @Post('password/reset/request')
  @HttpCode(HttpStatus.ACCEPTED)
  @Throttle({ default: { limit: 3, ttl: 15 * 60_000 } })
  async requestPasswordReset(
    @Body() dto: RequestPasswordResetDto,
  ): Promise<{ message: string }> {
    await this.auth.requestPasswordReset(dto);
    return {
      message:
        'Si los datos coinciden, recibirás un código para restablecer la contraseña',
    };
  }

  @Post('password/reset/confirm')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 5, ttl: 15 * 60_000 } })
  async confirmPasswordReset(
    @Body() dto: ConfirmPasswordResetDto,
    @Res({ passthrough: true }) response: Response,
  ): Promise<ClientSessionResponse> {
    return this.persistCustomerSession(
      await this.auth.confirmPasswordReset(dto, UserRole.CUSTOMER),
      response,
    );
  }

  @Post('password/change')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.CUSTOMER)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 5, ttl: 15 * 60_000 } })
  async changePassword(
    @CurrentUser() user: PublicUserDto,
    @Body() dto: ChangePasswordDto,
    @Res({ passthrough: true }) response: Response,
  ): Promise<ClientSessionResponse> {
    return this.persistCustomerSession(
      await this.auth.changePassword(
        user.id,
        dto.currentPassword,
        dto.newPassword,
        UserRole.CUSTOMER,
      ),
      response,
    );
  }

  @Get('me')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.CUSTOMER)
  @ApiBearerAuth()
  @ApiOkResponse({ description: 'Identidad de la sesión cliente actual' })
  me(@CurrentUser() user: PublicUserDto): { user: PublicUserDto } {
    return { user };
  }

  private async persistCustomerSession(
    session: {
      accessToken: string;
      refreshToken: string;
      refreshTokenExpiresAt: Date;
      tokenType: 'Bearer';
      expiresIn: string;
      user: PublicUserDto;
    },
    response: Response,
  ): Promise<ClientSessionResponse> {
    if (session.user.role !== UserRole.CUSTOMER || !session.user.isActive) {
      await this.auth.logout(session.refreshToken).catch(() => undefined);
      throw new ForbiddenException(
        'La cuenta no tiene acceso al portal de clientes',
      );
    }
    response.cookie(
      CLIENT_REFRESH_COOKIE,
      session.refreshToken,
      this.cookieOptions(session.refreshTokenExpiresAt),
    );
    return {
      accessToken: session.accessToken,
      tokenType: session.tokenType,
      expiresIn: session.expiresIn,
      user: session.user,
    };
  }

  private readRefreshCookie(request: Request): string | undefined {
    const raw = request.headers.cookie ?? '';
    for (const pair of raw.split(';')) {
      const separator = pair.indexOf('=');
      if (separator < 0) continue;
      const name = pair.slice(0, separator).trim();
      if (name !== CLIENT_REFRESH_COOKIE) continue;
      const value = pair.slice(separator + 1).trim();
      try {
        return decodeURIComponent(value);
      } catch {
        return undefined;
      }
    }
    return undefined;
  }

  private clearRefreshCookie(response: Response): void {
    response.clearCookie(CLIENT_REFRESH_COOKIE, this.cookieOptions());
  }

  private cookieOptions(expires?: Date): CookieOptions {
    const sameSite = this.sameSite();
    return {
      httpOnly: true,
      secure:
        this.config.get<string>('NODE_ENV') === 'production' ||
        sameSite === 'none',
      sameSite,
      path: CLIENT_SESSION_PATH,
      priority: 'high',
      ...(expires ? { expires: new Date(expires) } : {}),
    };
  }

  private sameSite(): 'lax' | 'strict' | 'none' {
    const value = (
      this.config.get<string>('CLIENT_SESSION_COOKIE_SAME_SITE') ?? 'lax'
    ).toLowerCase();
    return value === 'strict' || value === 'none' ? value : 'lax';
  }
}
