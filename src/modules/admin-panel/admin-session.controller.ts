import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Header,
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
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { AuthService } from '../auth/auth.service';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { LoginDto } from '../auth/dto/login.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { PublicUserDto } from '../users/dto/public-user.dto';
import { UserRole } from '../users/enums/user-role.enum';
import { AdminSessionOriginGuard } from './admin-session-origin.guard';

const ADMIN_REFRESH_COOKIE = 'sorteos_admin_refresh';
const ADMIN_SESSION_PATH = '/api/v1/admin/session';

@ApiTags('Admin session')
@UseGuards(AdminSessionOriginGuard)
@Controller('admin/session')
export class AdminSessionController {
  constructor(
    private readonly auth: AuthService,
    private readonly config: ConfigService,
  ) {}

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'private, no-store, max-age=0')
  @Throttle({
    default: { limit: 10, ttl: 60_000, blockDuration: 5 * 60_000 },
  })
  @ApiOperation({ summary: 'Inicia una sesión restringida al panel operativo' })
  async login(
    @Body() dto: LoginDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    const session = await this.auth.login(dto);
    await this.assertAdministrativeSession(session);
    this.writeRefreshCookie(
      response,
      session.refreshToken,
      session.refreshTokenExpiresAt,
    );
    return this.toPanelSession(session);
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'private, no-store, max-age=0')
  @Throttle({ default: { limit: 30, ttl: 60_000, blockDuration: 60_000 } })
  @ApiOperation({ summary: 'Rota la sesión administrativa HttpOnly' })
  async refresh(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const refreshToken = this.readRefreshCookie(request);
    if (!refreshToken) {
      throw new UnauthorizedException('Sesión administrativa ausente');
    }
    const session = await this.auth.refresh(refreshToken);
    await this.assertAdministrativeSession(session);
    this.writeRefreshCookie(
      response,
      session.refreshToken,
      session.refreshTokenExpiresAt,
    );
    return this.toPanelSession(session);
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Header('Cache-Control', 'private, no-store, max-age=0')
  @ApiOperation({ summary: 'Revoca y elimina la sesión administrativa' })
  async logout(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    const refreshToken = this.readRefreshCookie(request);
    if (refreshToken) {
      await this.auth.logout(refreshToken);
    }
    this.clearRefreshCookie(response);
  }

  @Get()
  @Header('Cache-Control', 'private, no-store, max-age=0')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.OPERATOR, UserRole.ADMIN)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Comprueba la identidad del panel' })
  current(@CurrentUser() user: PublicUserDto) {
    return { user };
  }

  private async assertAdministrativeSession(session: {
    user: PublicUserDto;
    refreshToken: string;
  }): Promise<void> {
    if (
      ![UserRole.OPERATOR, UserRole.ADMIN].includes(session.user.role) ||
      !session.user.isActive
    ) {
      await this.auth.logout(session.refreshToken).catch(() => undefined);
      throw new ForbiddenException(
        'La cuenta no tiene acceso al panel administrativo',
      );
    }
  }

  private toPanelSession(session: {
    accessToken: string;
    tokenType: 'Bearer';
    expiresIn: string;
    user: PublicUserDto;
  }) {
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
      if (name !== ADMIN_REFRESH_COOKIE) continue;
      const value = pair.slice(separator + 1).trim();
      try {
        return decodeURIComponent(value);
      } catch {
        return undefined;
      }
    }
    return undefined;
  }

  private writeRefreshCookie(
    response: Response,
    token: string,
    expiresAt: Date,
  ): void {
    response.cookie(ADMIN_REFRESH_COOKIE, token, {
      httpOnly: true,
      secure: this.config.get<string>('NODE_ENV') === 'production',
      sameSite: 'strict',
      path: ADMIN_SESSION_PATH,
      expires: new Date(expiresAt),
      priority: 'high',
    });
  }

  private clearRefreshCookie(response: Response): void {
    response.clearCookie(ADMIN_REFRESH_COOKIE, {
      httpOnly: true,
      secure: this.config.get<string>('NODE_ENV') === 'production',
      sameSite: 'strict',
      path: ADMIN_SESSION_PATH,
      priority: 'high',
    });
  }
}
