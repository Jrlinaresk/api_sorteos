import {
  BadRequestException,
  ConflictException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Cron } from '@nestjs/schedule';
import { Model } from 'mongoose';
import { EmailService } from './email.service';
import {
  TransactionalEmail,
  TransactionalEmailDocument,
  TransactionalEmailStatus,
} from './schema/transactional-email.schema';

const RETENTION_MILLISECONDS = 90 * 24 * 60 * 60 * 1_000;
const LOCK_MILLISECONDS = 5 * 60 * 1_000;

export interface TransactionalEmailInput {
  eventKey: string;
  recipient: string;
  subject: string;
  body: string;
}

@Injectable()
export class TransactionalEmailService {
  constructor(
    @InjectModel(TransactionalEmail.name)
    private readonly model: Model<TransactionalEmailDocument>,
    private readonly email: EmailService,
  ) {}

  async enqueueAndDeliver(input: TransactionalEmailInput): Promise<void> {
    const normalized = this.normalize(input);
    let existing = await this.model
      .findOne({ eventKey: normalized.eventKey })
      .exec();
    if (existing) {
      this.assertSameEvent(existing, normalized);
      if (existing.status === TransactionalEmailStatus.Sent) return;
    } else {
      try {
        existing = await this.model.create({
          ...normalized,
          status: TransactionalEmailStatus.Pending,
          attempts: 0,
          nextAttemptAt: new Date(),
          expiresAt: new Date(Date.now() + RETENTION_MILLISECONDS),
        });
      } catch (error) {
        if (!this.isDuplicateKey(error)) throw error;
        existing = await this.model
          .findOne({ eventKey: normalized.eventKey })
          .exec();
        if (!existing) throw error;
        this.assertSameEvent(existing, normalized);
        if (existing.status === TransactionalEmailStatus.Sent) return;
      }
    }
    await this.deliver(normalized.eventKey);
  }

  @Cron('*/30 * * * * *')
  async processPending(): Promise<number> {
    let processed = 0;
    for (let index = 0; index < 20; index += 1) {
      const candidate = await this.model
        .findOne({
          status: TransactionalEmailStatus.Pending,
          nextAttemptAt: { $lte: new Date() },
        })
        .sort({ nextAttemptAt: 1, createdAt: 1 })
        .select('eventKey')
        .lean()
        .exec();
      if (!candidate) break;
      await this.deliver(candidate.eventKey).catch(() => undefined);
      processed += 1;
    }
    return processed;
  }

  private async deliver(eventKey: string): Promise<void> {
    const now = new Date();
    const lockedAt = now;
    const claimed = await this.model
      .findOneAndUpdate(
        {
          eventKey,
          $or: [
            {
              status: TransactionalEmailStatus.Pending,
              nextAttemptAt: { $lte: now },
            },
            {
              status: TransactionalEmailStatus.Processing,
              lockedAt: {
                $lte: new Date(now.getTime() - LOCK_MILLISECONDS),
              },
            },
          ],
        },
        {
          $set: { status: TransactionalEmailStatus.Processing, lockedAt },
        },
        { new: true },
      )
      .exec();
    if (!claimed) {
      const current = await this.model.findOne({ eventKey }).exec();
      if (current?.status === TransactionalEmailStatus.Sent) return;
      throw new ServiceUnavailableException(
        'El correo transaccional está pendiente de reintento',
      );
    }

    try {
      await this.email.sendTransactionalEmail(
        claimed.recipient,
        claimed.eventKey,
        claimed.subject,
        claimed.body,
      );
      const updated = await this.model
        .updateOne(
          {
            _id: claimed._id,
            status: TransactionalEmailStatus.Processing,
            lockedAt,
          },
          {
            $set: {
              status: TransactionalEmailStatus.Sent,
              sentAt: new Date(),
            },
            $unset: { lockedAt: 1, lastError: 1 },
          },
        )
        .exec();
      if (updated.modifiedCount !== 1) {
        throw new ServiceUnavailableException(
          'Se perdió el lease del correo transaccional',
        );
      }
    } catch (error) {
      const attempts = (claimed.attempts ?? 0) + 1;
      const delaySeconds = Math.min(3_600, 5 * 2 ** Math.min(attempts, 9));
      await this.model
        .updateOne(
          {
            _id: claimed._id,
            status: TransactionalEmailStatus.Processing,
            lockedAt,
          },
          {
            $set: {
              status: TransactionalEmailStatus.Pending,
              attempts,
              nextAttemptAt: new Date(Date.now() + delaySeconds * 1_000),
              lastError: (error instanceof Error
                ? error.message
                : String(error)
              ).slice(0, 500),
            },
            $unset: { lockedAt: 1 },
          },
        )
        .exec();
      throw error;
    }
  }

  private normalize(input: TransactionalEmailInput): TransactionalEmailInput {
    const eventKey = input.eventKey.trim();
    const recipient = input.recipient.trim().toLowerCase();
    const subject = input.subject.trim();
    const body = input.body.trim();
    if (!/^[A-Za-z0-9._:-]{8,160}$/.test(eventKey)) {
      throw new BadRequestException('eventKey de correo inválida');
    }
    if (
      recipient.length > 254 ||
      /[\r\n]/.test(recipient) ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient)
    ) {
      throw new BadRequestException('Destinatario transaccional inválido');
    }
    if (!subject || subject.length > 140 || /[\r\n]/.test(subject)) {
      throw new BadRequestException('Asunto transaccional inválido');
    }
    if (!body || body.length > 4_000) {
      throw new BadRequestException('Contenido transaccional inválido');
    }
    return { eventKey, recipient, subject, body };
  }

  private assertSameEvent(
    existing: TransactionalEmailDocument,
    input: TransactionalEmailInput,
  ): void {
    if (
      existing.recipient !== input.recipient ||
      existing.subject !== input.subject ||
      existing.body !== input.body
    ) {
      throw new ConflictException(
        'La clave transaccional ya pertenece a otro correo',
      );
    }
  }

  private isDuplicateKey(error: unknown): boolean {
    return Boolean(
      error &&
      typeof error === 'object' &&
      'code' in error &&
      (error as { code?: number }).code === 11000,
    );
  }
}
