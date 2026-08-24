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
import { ClientSession, Model } from 'mongoose';
import { EmailService } from './email.service';
import { EmailVerificationPurpose } from './enums/email-verification-purpose.enum';
import {
  EmailVerification,
  EmailVerificationDocument,
} from './schema/email-verification.schema';

const EMAIL_CODE_COOLDOWN_MILLISECONDS = 60_000;
const EMAIL_CODE_LIFETIME_MILLISECONDS = 15 * 60_000;

@Injectable()
export class EmailVerificationService {
  private readonly logger = new Logger(EmailVerificationService.name);

  constructor(
    @InjectModel(EmailVerification.name)
    private readonly verificationModel: Model<EmailVerificationDocument>,
    private readonly emailService: EmailService,
    private readonly config: ConfigService,
  ) {}

  async createVerificationCode(
    rawEmail: string,
    purpose = EmailVerificationPurpose.Generic,
    binding = '',
  ): Promise<void> {
    const email = rawEmail.trim().toLowerCase();
    const now = new Date();
    const expiresAt = new Date(
      now.getTime() + EMAIL_CODE_LIFETIME_MILLISECONDS,
    );
    const code = String(randomInt(100_000, 1_000_000));
    const bindingHash = this.hashBinding(purpose, binding);
    const codeHash = this.hash(email, code, purpose, binding);
    let document: EmailVerificationDocument | null;
    try {
      document = await this.verificationModel
        .findOneAndUpdate(
          {
            email,
            $or: [
              {
                createdAt: {
                  $lte: new Date(
                    now.getTime() - EMAIL_CODE_COOLDOWN_MILLISECONDS,
                  ),
                },
              },
              { expiresAt: { $lte: now } },
              { createdAt: { $exists: false } },
            ],
          },
          {
            $set: {
              email,
              codeHash,
              bindingHash,
              attempts: 0,
              purpose,
              createdAt: now,
              expiresAt,
            },
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

  async verifyCode(
    rawEmail: string,
    rawCode: string,
    purpose = EmailVerificationPurpose.Generic,
    binding = '',
    session?: ClientSession,
  ): Promise<void> {
    const email = rawEmail.trim().toLowerCase();
    const code = rawCode.trim().toUpperCase();
    const now = new Date();
    const bindingHash = this.hashBinding(purpose, binding);
    const verificationQuery = this.verificationModel
      .findOneAndUpdate(
        {
          email,
          purpose,
          bindingHash,
          expiresAt: { $gt: now },
          attempts: { $lt: 5 },
        },
        { $inc: { attempts: 1 } },
        { new: true },
      )
      .select('+codeHash +code');
    if (session) verificationQuery.session(session);
    const record = await verificationQuery.exec();
    if (!record) throw this.invalidCode();

    const candidate = this.hash(email, code, purpose, binding);
    const expected = record.codeHash || '';
    const hashMatches = this.safeEqual(candidate, expected);
    const legacyMatches = Boolean(
      purpose === EmailVerificationPurpose.Generic &&
      binding === '' &&
      record.code &&
      this.safeEqual(code, record.code),
    );
    if (!hashMatches && !legacyMatches) {
      if (record.attempts >= 5) {
        const deleteQuery = this.verificationModel.deleteOne({
          _id: record._id,
          createdAt: record.createdAt,
        });
        if (session) deleteQuery.session(session);
        await deleteQuery.exec();
      }
      throw this.invalidCode();
    }
    const secretFilter = hashMatches
      ? { codeHash: record.codeHash }
      : { code: record.code };
    const consumptionQuery = this.verificationModel.findOneAndDelete({
      _id: record._id,
      createdAt: record.createdAt,
      purpose,
      bindingHash,
      expiresAt: { $gt: now },
      ...secretFilter,
    });
    if (session) consumptionQuery.session(session);
    const consumed = await consumptionQuery.exec();
    if (!consumed) throw this.invalidCode();
  }

  async invalidateEmail(rawEmail: string): Promise<void> {
    await this.verificationModel
      .deleteMany({ email: rawEmail.trim().toLowerCase() })
      .catch((error: unknown) => {
        const errorName =
          error instanceof Error && error.name ? error.name : 'UnknownError';
        this.logger.warn(
          `No se pudieron invalidar códigos (${errorName.replace(/[^A-Za-z0-9_.:-]/g, '').slice(0, 80) || 'UnknownError'})`,
        );
      });
  }

  private hash(
    email: string,
    code: string,
    purpose: EmailVerificationPurpose,
    binding: string,
  ) {
    return createHmac('sha256', this.secret())
      .update(`code:${purpose}:${email}:${binding}:${code}`)
      .digest('hex');
  }

  private hashBinding(
    purpose: EmailVerificationPurpose,
    binding: string,
  ): string {
    return createHmac('sha256', this.secret())
      .update(`binding:${purpose}:${binding}`)
      .digest('hex');
  }

  private secret() {
    const secret =
      this.config.get<string>('EMAIL_CODE_SECRET') ||
      this.config.get<string>('JWT_SECRET');
    if (!secret || secret.length < 32) {
      throw new InternalServerErrorException(
        'EMAIL_CODE_SECRET no está configurado de forma segura',
      );
    }
    return secret;
  }

  private safeEqual(left: string, right: string) {
    const a = Buffer.from(left);
    const b = Buffer.from(right);
    return a.length === b.length && timingSafeEqual(a, b);
  }

  private invalidCode() {
    return new BadRequestException(
      'Código de verificación inválido o expirado',
    );
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
