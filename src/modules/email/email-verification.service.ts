// src/modules/email/email-verification.service.ts

import {
  Injectable,
  BadRequestException,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import * as crypto from 'crypto';

import { EmailService } from './email.service';
import {
  EmailVerification,
  EmailVerificationDocument,
} from './schema/email-verification.schema';

@Injectable()
export class EmailVerificationService {
  private readonly logger = new Logger(EmailVerificationService.name);

  constructor(
    @InjectModel(EmailVerification.name)
    private readonly verificationModel: Model<EmailVerificationDocument>,
    private readonly emailService: EmailService,
  ) {}

  /**
   * Crea un código de verificación para el email dado.
   */
  async createVerificationCode(email: string): Promise<void> {
    // 1) Limpiar cualquier código previo
    try {
      await this.verificationModel.deleteMany({ email });
    } catch (err) {
      this.logger.error(
        `Error limpiando códigos previos para ${email}: ${err.message}`,
      );
    }

    // 2) Generar código alfanumérico de 6 chars
    const code = crypto
      .randomBytes(4)
      .toString('base64')
      .replace(/[^a-zA-Z0-9]/g, '')
      .substring(0, 6)
      .toUpperCase();

    // 3) Guardar en MongoDB (TTL index en schema)
    const doc = new this.verificationModel({
      email,
      code,
      createdAt: new Date(),
    });
    try {
      await doc.save();
    } catch (err) {
      this.logger.error(`Error guardando token para ${email}: ${err.message}`);
      throw new InternalServerErrorException(
        'No se pudo generar el código de verificación.',
      );
    }

    // 4) Enviar el correo con el código
    try {
      await this.emailService.sendVerificationEmail(email, code);
      this.logger.log(`Código de verificación enviado a ${email}`);
    } catch (err) {
      // Limpia el token si falla el envío
      await this.verificationModel.deleteOne({ _id: doc._id }).catch(() => {});
      throw err;
    }
  }

  /**
   * Verifica que el código coincida para el email dado y lo elimina.
   * NO toca la colección de clientes: solo autoriza la creación posterior.
   */
  async verifyCode(email: string, code: string): Promise<void> {
    // 1) Buscar el token en la colección de verificaciones
    const record = await this.verificationModel.findOne({ email, code });
    if (!record) {
      throw new BadRequestException(
        'Código de verificación inválido o expirado.',
      );
    }

    // 2) Eliminar el token verificado para que no se reutilice
    try {
      await this.verificationModel.deleteOne({ _id: record._id });
      this.logger.log(`Token de verificación eliminado para ${email}`);
    } catch (err) {
      this.logger.error(`Error eliminando token para ${email}: ${err.message}`);
      // No interrumpimos: la verificación ya es válida
    }
  }

  /**
   * Elimina cualquier token pendiente (por ejemplo, tras un registro).
   */
  async invalidateEmail(email: string): Promise<void> {
    try {
      await this.verificationModel.deleteMany({ email });
      this.logger.log(`Tokens pendientes invalidados para ${email}`);
    } catch (err) {
      this.logger.error(
        `Error invalidando tokens para ${email}: ${err.message}`,
      );
    }
  }
}
