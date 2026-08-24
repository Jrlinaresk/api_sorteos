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
    const now = new Date();
    const code = String(randomInt(100_000, 1_000_000));
    const codeHash = this.hash(email, code);
    let document: EmailVerificationDocument | null;
    try {
      document = await this.verificationModel
        .findOneAndUpdate(
          {
            email,
            $or: [
              { createdAt: { $lte: new Date(now.getTime() - 60_000) } },
              { createdAt: { $exists: false } },
            ],
          },
          {
            $set: { email, codeHash, attempts: 0, createdAt: now },
            $unset: { code: 1 },
          },
          { new: true, upsert: true, setDefaultsOnInsert: true },
        )
        .exec();
    } catch (error) {
      if (this.isDuplicateKeyError(error)) throw this.tooManyRequests();
      throw error;
    }
    if (!document) {
      throw new InternalServerErrorException(
        'No se pudo generar el código de verificación',
      );
    }

    try {
      await this.emailService.sendVerificationEmail(email, code);
    } catch (error) {
      await this.verificationModel
        .deleteOne({ _id: document._id, codeHash })
        .catch(() => undefined);
      throw error;
    }
  }

  async verifyCode(rawEmail: string, rawCode: string): Promise<void> {
    const email = rawEmail.trim().toLowerCase();
    const code = rawCode.trim().toUpperCase();
    const record = await this.verificationModel
      .findOneAndUpdate(
        { email, attempts: { $lt: 5 } },
        { $inc: { attempts: 1 } },
        { new: true },
      )
      .select('+codeHash +code')
      .exec();
    if (!record) throw this.invalidCode();

    const candidate = this.hash(email, code);
    const expected = record.codeHash || '';
    const hashMatches = this.safeEqual(candidate, expected);
    const legacyMatches = Boolean(record.code && this.safeEqual(code, record.code));
    if (!hashMatches && !legacyMatches) {
      if (record.attempts >= 5) {
        await this.verificationModel.deleteOne({
          _id: record._id,
          createdAt: record.createdAt,
        });
      }
      throw this.invalidCode();
    }
    const secretFilter = hashMatches
      ? { codeHash: record.codeHash }
      : { code: record.code };
    const consumed = await this.verificationModel.findOneAndDelete({
      _id: record._id,
      createdAt: record.createdAt,
      ...secretFilter,
    });
    if (!consumed) throw this.invalidCode();
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

  private tooManyRequests() {
    return new HttpException(
      'Espere antes de solicitar otro código',
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }

  private isDuplicateKeyError(error: unknown): boolean {
    return Boolean(
      error &&
        typeof error === 'object' &&
        'code' in error &&
        (error as { code?: number }).code === 11000,
    );
  }
}
