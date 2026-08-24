import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export enum TransactionalEmailStatus {
  Pending = 'pending',
  Processing = 'processing',
  Sent = 'sent',
}

export type TransactionalEmailDocument = HydratedDocument<TransactionalEmail>;

@Schema({ timestamps: true, collection: 'transactional_email_outbox' })
export class TransactionalEmail {
  @Prop({ required: true, unique: true, trim: true, maxlength: 160 })
  eventKey: string;

  @Prop({ required: true, trim: true, lowercase: true, maxlength: 254 })
  recipient: string;

  @Prop({ required: true, trim: true, maxlength: 140 })
  subject: string;

  @Prop({ required: true, maxlength: 4_000 })
  body: string;

  @Prop({
    required: true,
    enum: Object.values(TransactionalEmailStatus),
    default: TransactionalEmailStatus.Pending,
    index: true,
  })
  status: TransactionalEmailStatus;

  @Prop({ required: true, min: 0, default: 0 })
  attempts: number;

  @Prop({ required: true, default: Date.now, index: true })
  nextAttemptAt: Date;

  @Prop()
  lockedAt?: Date;

  @Prop()
  sentAt?: Date;

  @Prop({ maxlength: 500 })
  lastError?: string;

  @Prop({ required: true })
  expiresAt: Date;

  createdAt: Date;
  updatedAt: Date;
}

export const TransactionalEmailSchema =
  SchemaFactory.createForClass(TransactionalEmail);

TransactionalEmailSchema.index({ status: 1, nextAttemptAt: 1 });
TransactionalEmailSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
