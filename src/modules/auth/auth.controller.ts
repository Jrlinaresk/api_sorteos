import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiTags,
  ApiUnauthorizedResponse,
  ApiAcceptedResponse,
} from '@nestjs/swagger';
import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { AuthResponseDto } from './dto/auth-response.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { CurrentUser } from './decorators/current-user.decorator';
import { PublicUserDto } from '../users/dto/public-user.dto';
import { RequestPasswordResetDto } from './dto/request-password-reset.dto';
import { ConfirmPasswordResetDto } from './dto/confirm-password-reset.dto';
import { Throttle } from '@nestjs/throttler';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { RegistrationAcceptedDto } from './dto/registration-accepted.dto';
import { ConfirmRegistrationDto } from './dto/confirm-registration.dto';
import { ResendRegistrationCodeDto } from './dto/resend-registration-code.dto';

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('register')
  @Throttle({ default: { limit: 5, ttl: 60 * 60 * 1000 } })
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiAcceptedResponse({
    type: RegistrationAcceptedDto,
    description:
      'Respuesta genérica: no revela si teléfono, CPF o correo ya existen',
  })
  register(@Body() dto: RegisterDto): Promise<RegistrationAcceptedDto> {
    return this.authService.register(dto);
  }

  @Post('register/resend')
  @Throttle({ default: { limit: 5, ttl: 60 * 60 * 1000 } })
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiAcceptedResponse({
    type: RegistrationAcceptedDto,
    description: 'Respuesta genérica sin revelar si existe un alta pendiente',
  })
  resendRegistrationCode(
    @Body() dto: ResendRegistrationCodeDto,
  ): Promise<RegistrationAcceptedDto> {
    return this.authService.resendRegistrationCode(dto);
  }

  @Post('register/confirm')
  @Throttle({ default: { limit: 5, ttl: 15 * 60 * 1000 } })
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: AuthResponseDto })
  @ApiUnauthorizedResponse({
    description: 'Código inválido, vencido o alta no disponible',
  })
  confirmRegistration(
    @Body() dto: ConfirmRegistrationDto,
  ): Promise<AuthResponseDto> {
    return this.authService.confirmRegistration(dto);
  }

  @Post('login')
  @Throttle({
    default: { limit: 10, ttl: 60 * 1000, blockDuration: 5 * 60 * 1000 },
  })
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: AuthResponseDto })
  @ApiUnauthorizedResponse({ description: 'Credenciales inválidas' })
  login(@Body() dto: LoginDto): Promise<AuthResponseDto> {
    return this.authService.login(dto);
  }

  @Post('password/reset/request')
  @Throttle({ default: { limit: 3, ttl: 15 * 60 * 1000 } })
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiAcceptedResponse({
    description:
      'La solicitud se procesa sin revelar si la cuenta está registrada',
  })
  async requestPasswordReset(
    @Body() dto: RequestPasswordResetDto,
  ): Promise<{ message: string }> {
    await this.authService.requestPasswordReset(dto);
    return {
      message:
        'Si los datos coinciden, recibirás un código para restablecer la contraseña',
    };
  }

  @Post('password/reset/confirm')
  @Throttle({ default: { limit: 5, ttl: 15 * 60 * 1000 } })
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: AuthResponseDto })
  @ApiUnauthorizedResponse({ description: 'Código inválido o vencido' })
  confirmPasswordReset(
    @Body() dto: ConfirmPasswordResetDto,
  ): Promise<AuthResponseDto> {
    return this.authService.confirmPasswordReset(dto);
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 20, ttl: 60 * 1000 } })
  refresh(@Body() dto: RefreshTokenDto): Promise<AuthResponseDto> {
    return this.authService.refresh(dto.refreshToken);
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(@Body() dto: RefreshTokenDto): Promise<void> {
    await this.authService.logout(dto.refreshToken);
  }

  @Post('password/change')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 5, ttl: 15 * 60 * 1000 } })
  changePassword(
    @CurrentUser() user: PublicUserDto,
    @Body() dto: ChangePasswordDto,
  ): Promise<AuthResponseDto> {
    return this.authService.changePassword(
      user.id,
      dto.currentPassword,
      dto.newPassword,
    );
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOkResponse({ type: PublicUserDto })
  @ApiUnauthorizedResponse({ description: 'Token ausente, inválido o vencido' })
  me(@CurrentUser() user: PublicUserDto): PublicUserDto {
    return user;
  }
}
