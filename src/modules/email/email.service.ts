import {
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { existsSync, readFileSync } from 'fs';
import * as handlebars from 'handlebars';
import { createTransport, Transporter } from 'nodemailer';
import { join } from 'path';

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private readonly htmlTemplate: HandlebarsTemplateDelegate;
  private readonly logoPath?: string;
  private transporter?: Transporter;

  constructor(private readonly config: ConfigService) {
    this.htmlTemplate = handlebars.compile(this.loadTemplate());
    this.logoPath = this.findAsset('assets/img/full_logo_color.png');
  }

  async sendVerificationEmail(
    rawRecipient: string,
    code: string,
  ): Promise<void> {
    const recipient = rawRecipient.trim().toLowerCase();
    if (!this.isSafeRecipient(recipient) || !/^\d{6}$/.test(code)) {
      throw new InternalServerErrorException(
        'No se pudo preparar el correo de verificación',
      );
    }

    const from =
      this.config.get<string>('SMTP_FROM')?.trim() ||
      this.config.get<string>('SMTP_USER')?.trim();
    if (!from || /[\r\n]/.test(from)) {
      throw this.configurationError('SMTP_FROM');
    }

    try {
      await this.getTransporter().sendMail({
        from,
        to: recipient,
        subject: 'Tu código de verificación',
        text: [
          'Hola,',
          '',
          `Tu código de verificación es: ${code}`,
          '',
          'Si no lo solicitaste, ignora este correo.',
        ].join('\n'),
        html: this.htmlTemplate({ code }),
        attachments: this.logoPath
          ? [
              {
                filename: 'logo.png',
                path: this.logoPath,
                cid: 'logo',
                contentDisposition: 'inline',
              },
            ]
          : undefined,
      });
      this.logger.log('Correo de verificación aceptado por el servidor SMTP');
    } catch (error) {
      const errorCode = this.smtpErrorCode(error);
      this.logger.error(
        `Falló el envío SMTP${errorCode ? ` (${errorCode})` : ''}`,
      );
      throw new InternalServerErrorException(
        'No se pudo enviar el correo de verificación',
      );
    }
  }

  private getTransporter(): Transporter {
    if (this.transporter) return this.transporter;

    const host = this.config.get<string>('SMTP_HOST')?.trim();
    const portValue = this.config.get<string>('SMTP_PORT')?.trim() ?? '587';
    const port = Number(portValue);
    const user = this.config.get<string>('SMTP_USER')?.trim();
    const pass = this.config.get<string>('SMTP_PASS');
    if (!host || !Number.isInteger(port) || port < 1 || port > 65_535) {
      throw this.configurationError('SMTP_HOST/SMTP_PORT');
    }
    if (Boolean(user) !== Boolean(pass)) {
      throw this.configurationError('SMTP_USER/SMTP_PASS');
    }

    const secure = this.booleanConfig('SMTP_SECURE', port === 465);
    const production = this.config.get<string>('NODE_ENV') === 'production';
    this.transporter = createTransport({
      host,
      port,
      secure,
      requireTLS: this.booleanConfig('SMTP_REQUIRE_TLS', production && !secure),
      auth: user && pass ? { user, pass } : undefined,
      connectionTimeout: this.integerConfig(
        'SMTP_CONNECTION_TIMEOUT_MS',
        10_000,
      ),
      greetingTimeout: this.integerConfig('SMTP_GREETING_TIMEOUT_MS', 10_000),
      socketTimeout: this.integerConfig('SMTP_SOCKET_TIMEOUT_MS', 20_000),
      tls: {
        minVersion: 'TLSv1.2',
        rejectUnauthorized: this.booleanConfig(
          'SMTP_TLS_REJECT_UNAUTHORIZED',
          true,
        ),
      },
    });
    return this.transporter;
  }

  private loadTemplate(): string {
    const templatePath = this.findAsset('templates/verification.html');
    if (templatePath) return readFileSync(templatePath, 'utf8');

    this.logger.warn(
      'No se encontró la plantilla de verificación; se usará la plantilla segura integrada',
    );
    return [
      '<!doctype html><html lang="es"><body>',
      '<h1>Verificación de correo</h1>',
      '<p>Tu código de verificación es:</p>',
      '<p style="font-size:28px;font-weight:bold;letter-spacing:4px">{{code}}</p>',
      '<p>Si no lo solicitaste, ignora este correo.</p>',
      '</body></html>',
    ].join('');
  }

  private findAsset(relativePath: string): string | undefined {
    const candidates = [
      join(process.cwd(), 'src', relativePath),
      join(process.cwd(), 'dist', relativePath),
      join(__dirname, '..', '..', relativePath),
    ];
    return candidates.find((candidate) => existsSync(candidate));
  }

  private booleanConfig(name: string, fallback: boolean): boolean {
    const value = this.config.get<string>(name);
    if (value === undefined || value === '') return fallback;
    return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
  }

  private integerConfig(name: string, fallback: number): number {
    const value = Number(this.config.get<string>(name) ?? fallback);
    return Number.isInteger(value) && value > 0 ? value : fallback;
  }

  private isSafeRecipient(value: string): boolean {
    return (
      value.length <= 254 &&
      !/[\r\n]/.test(value) &&
      /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
    );
  }

  private configurationError(variable: string) {
    this.logger.error(`Configuración SMTP incompleta o inválida: ${variable}`);
    return new InternalServerErrorException(
      'El servicio de correo no está configurado',
    );
  }

  private smtpErrorCode(error: unknown): string | undefined {
    if (!error || typeof error !== 'object' || !('code' in error)) {
      return undefined;
    }
    const code = String((error as { code?: unknown }).code ?? '');
    return /^[A-Z0-9_-]{1,32}$/.test(code) ? code : undefined;
  }
}
