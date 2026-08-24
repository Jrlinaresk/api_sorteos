import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { createHmac, randomInt, timingSafeEqual } from 'crypto';
import { Model } from 'mongoose';
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
    private readonly config: ConfigService,
  ) {}

  async createVerificationCode(rawEmail: string): Promise<void> {
    const email = rawEmail.trim().toLowerCase();
    const previous = await this.verificationModel.findOne({ email }).lean();
    if (previous && previous.createdAt.getTime() > Date.now() - 60_000) {
      throw new HttpException('Espere antes de solicitar otro código', HttpStatus.TOO_MANY_REQUESTS);
    }

    const code = String(randomInt(100_000, 1_000_000));
    const codeHash = this.hash(email, code);
    const document = await this.verificationModel.findOneAndUpdate(
      { email },
      { $set: { email, codeHash, attempts: 0, createdAt: new Date() }, $unset: { code: 1 } },
      { new: true, upsert: true, setDefaultsOnInsert: true },
    );
    if (!document) {
      throw new InternalServerErrorException('No se pudo generar el código de verificación');
    }

    try {
      await this.emailService.sendVerificationEmail(email, code);
    } catch (error) {
      await this.verificationModel.deleteOne({ _id: document._id }).catch(() => undefined);
      throw error;
    }
  }

  async verifyCode(rawEmail: string, rawCode: string): Promise<void> {
    const email = rawEmail.trim().toLowerCase();
    const code = rawCode.trim().toUpperCase();
    const record = await this.verificationModel
      .findOne({ email })
      .select('+codeHash +code')
      .exec();
    if (!record || record.attempts >= 5) {
      if (record) await record.deleteOne();
      throw this.invalidCode();
    }

    const candidate = this.hash(email, code);
    const expected = record.codeHash || '';
    const hashMatches = this.safeEqual(candidate, expected);
    const legacyMatches = Boolean(record.code && this.safeEqual(code, record.code));
    if (!hashMatches && !legacyMatches) {
      record.attempts += 1;
      if (record.attempts >= 5) await record.deleteOne();
      else await record.save();
      throw this.invalidCode();
    }
    await record.deleteOne();
  }

  async invalidateEmail(rawEmail: string): Promise<void> {
    await this.verificationModel
      .deleteMany({ email: rawEmail.trim().toLowerCase() })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.warn(`No se pudieron invalidar códigos: ${message}`);
      });
  }

  private hash(email: string, code: string) {
    return createHmac('sha256', this.secret()).update(`${email}:${code}`).digest('hex');
  }

  private secret() {
    const secret =
      this.config.get<string>('EMAIL_CODE_SECRET') || this.config.get<string>('JWT_SECRET');
    if (!secret || secret.length < 32) {
      throw new InternalServerErrorException('EMAIL_CODE_SECRET no está configurado de forma segura');
    }
    return secret;
  }

  private safeEqual(left: string, right: string) {
    const a = Buffer.from(left);
    const b = Buffer.from(right);
    return a.length === b.length && timingSafeEqual(a, b);
  }

  private invalidCode() {
    return new BadRequestException('Código de verificación inválido o expirado');
  }
}
