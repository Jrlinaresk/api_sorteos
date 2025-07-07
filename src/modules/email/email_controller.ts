import {
  Controller,
  Post,
  Body,
  BadRequestException,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { EmailService } from './email.service';
import { SendCodeDto } from './dto/send-code.dto';
import { VerifyCodeDto } from './dto/verify-code.dto';
import { EmailVerificationService } from './email-verification.service';

@ApiTags('Email')
@Controller('email')
export class EmailController {
  constructor(
    private readonly emailService: EmailService,
    private readonly verificationService: EmailVerificationService,
  ) {}

  @Post('send-code')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Envía código de verificación al correo' })
  @ApiResponse({
    status: 200,
    description: 'El código de verificación fue enviado correctamente.',
  })
  @ApiResponse({
    status: 400,
    description: 'El correo electrónico no es válido.',
  })
  @ApiResponse({
    status: 500,
    description: 'No se pudo enviar el correo de verificación.',
  })
  async sendCode(@Body() dto: SendCodeDto) {
    const { email } = dto;

    // Validar que sea un email con formato básico
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      throw new BadRequestException('El correo electrónico no es válido.');
    }

    // Generar y guardar código + enviar email
    try {
      await this.verificationService.createVerificationCode(email);
      return { message: 'Código enviado correctamente.' };
    } catch (err) {
      // La excepción interna ya usa mensajes en español
      throw err;
    }
  }

  @Post('verify-code')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Verifica el código enviado por email' })
  @ApiResponse({
    status: 200,
    description: 'El correo fue verificado correctamente.',
  })
  @ApiResponse({
    status: 400,
    description: 'Código de verificación inválido o expirado.',
  })
  async verifyCode(@Body() dto: VerifyCodeDto) {
    const { email, code } = dto;
    await this.verificationService.verifyCode(email, code);
    return { message: 'Correo verificado correctamente.' };
  }
}
