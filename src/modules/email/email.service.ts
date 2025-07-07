import {
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { connect, TLSSocket } from 'tls';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import * as handlebars from 'handlebars';

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private readonly host: string;
  private readonly port: number;
  private readonly user: string;
  private readonly pass: string;
  private socket: TLSSocket;

  // Plantilla compilada (con <img src="cid:logo" />)
  private readonly htmlTemplate: HandlebarsTemplateDelegate;

  constructor() {
    const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS } = process.env;
    if (!SMTP_HOST || !SMTP_PORT || !SMTP_USER || !SMTP_PASS) {
      throw new Error(
        'EmailService: faltan variables de entorno SMTP_HOST, SMTP_PORT, SMTP_USER o SMTP_PASS',
      );
    }
    this.host = SMTP_HOST;
    this.port = parseInt(SMTP_PORT, 10);
    this.user = SMTP_USER;
    this.pass = SMTP_PASS;

    // Cargo y compilo la plantilla HTML una sola vez
    const tplPath = path.join(
      process.cwd(),
      'src',
      'templates',
      'verification.html',
    );
    const tplSource = fs.readFileSync(tplPath, 'utf-8');
    this.htmlTemplate = handlebars.compile(tplSource);
  }

  private async openConnection(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.socket = connect(
        { host: this.host, port: this.port, rejectUnauthorized: true },
        () => resolve(),
      );
      this.socket.once('error', (err) => {
        this.logger.error('Error en conexión SMTP', err);
        reject(err);
      });
    });
  }

  private async sendCmd(cmd: string): Promise<string> {
    return new Promise((resolve, reject) => {
      let response = '';
      const onData = (data: Buffer) => {
        response += data.toString();
        const lines = response.split('\r\n');
        const last = lines[lines.length - 2] || '';
        if (/^\d{3} /.test(last)) {
          cleanup();
          resolve(response);
        }
      };
      const onError = (err: Error) => {
        cleanup();
        reject(err);
      };
      const cleanup = () => {
        this.socket.removeListener('data', onData);
        this.socket.removeListener('error', onError);
      };
      this.socket.on('data', onData);
      this.socket.once('error', onError);
      if (cmd) this.socket.write(cmd + '\r\n');
    });
  }

  async sendVerificationEmail(to: string, code: string) {
    try {
      this.logger.debug(`Enviando correo a "${to}" con código "${code}"`);

      // 0) Abrir TLS
      await this.openConnection();

      // 1) EHLO
      await this.sendCmd(`EHLO ${this.host}`);

      // 2) AUTH LOGIN
      await this.sendCmd('AUTH LOGIN');
      await this.sendCmd(Buffer.from(this.user).toString('base64'));
      await this.sendCmd(Buffer.from(this.pass).toString('base64'));

      // 3) MAIL FROM, RCPT TO, DATA
      await this.sendCmd(`MAIL FROM:<${this.user}>`);
      await this.sendCmd(`RCPT TO:<${to}>`);
      await this.sendCmd('DATA');

      // 4) Leer logo y convertir a Base64
      const logoPath = path.join(
        process.cwd(),
        'src',
        'assets',
        'img',
        'full_logo_color.png',
      );
      const logoData = fs.readFileSync(logoPath);
      const logoBase64 = logoData.toString('base64');

      // 5) Preparar cuerpos de texto y HTML (HTML referencia cid:logo)
      const textBody = `Hola,\n\nTu código de verificación es: ${code}\n\nSi no lo solicitaste, ignora este correo.`;
      const htmlBody = this.htmlTemplate({ code });

      // 6) Definir boundaries
      const boundaryRelated = '----=_Rel_' + crypto.randomUUID();
      const boundaryAlt = '----=_Alt_' + crypto.randomUUID();

      // 7) Cabeceras principales
      const headers = [
        `From: ${this.user}`,
        `To: ${to}`,
        `Subject: Tu código de verificación`,
        `Date: ${new Date().toUTCString()}`,
        `Message-ID: <${crypto.randomUUID()}@${this.host}>`,
        `MIME-Version: 1.0`,
        `Content-Type: multipart/related; boundary="${boundaryRelated}"`,
        '',
      ];

      // 8) Parte multipart/alternative (texto + HTML)
      const altPart = [
        `--${boundaryRelated}`,
        `Content-Type: multipart/alternative; boundary="${boundaryAlt}"`,
        '',
        // Texto plano
        `--${boundaryAlt}`,
        `Content-Type: text/plain; charset="utf-8"`,
        '',
        textBody,
        '',
        // HTML
        `--${boundaryAlt}`,
        `Content-Type: text/html; charset="utf-8"`,
        '',
        htmlBody,
        '',
        `--${boundaryAlt}--`,
        '',
      ].join('\r\n');

      // 9) Parte de la imagen inline
      const imagePart = [
        `--${boundaryRelated}`,
        `Content-Type: image/png; name="logo.png"`,
        `Content-Transfer-Encoding: base64`,
        `Content-ID: <logo>`,
        `Content-Disposition: inline; filename="logo.png"`,
        '',
        logoBase64,
        '',
        `--${boundaryRelated}--`,
        '',
      ].join('\r\n');

      // 10) Unir todo y enviar
      const emailContent = [
        ...headers,
        altPart,
        imagePart,
        '.', // fin DATA
        '',
      ].join('\r\n');

      this.socket.write(emailContent + '\r\n');

      // 11) Esperar respuesta tras DATA
      await new Promise<void>((resolve, reject) => {
        const onData = (data: Buffer) => {
          const text = data.toString('utf-8').trim();
          this.logger.debug(`RESPUESTA SMTP: ${text}`);
          resolve();
        };
        const onError = (err: Error) => reject(err);
        this.socket.once('data', onData);
        this.socket.once('error', onError);
      });

      // 12) QUIT y cerrar
      await this.sendCmd('QUIT');
      this.socket.end();

      this.logger.log(`✅ Correo enviado correctamente a ${to}`);
    } catch (err: any) {
      this.logger.error(`❌ Error al enviar correo: ${err.message}`, err.stack);
      if (this.socket && !this.socket.destroyed) this.socket.destroy();
      throw new InternalServerErrorException(
        'No se pudo enviar el correo de verificación',
      );
    }
  }
}
