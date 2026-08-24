import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import {
  PaymentCurrency,
  PaymentEventSource,
  PaymentProviderName,
  PaymentStatus,
} from '../payment.enums';

export type PaymentOutboxDocument = HydratedDocument<PaymentOutboxEvent>;

export enum PaymentOutboxStatus {
  Pending = 'pending',
  Processing = 'processing',
  Succeeded = 'succeeded',
  DeadLetter = 'dead_letter',
}

@Schema({ timestamps: true, collection: 'payment_lifecycle_outbox' })
export class PaymentOutboxEvent {
  @Prop({ required: true, unique: true })
  eventKey: string;

  @Prop({ type: Types.ObjectId, ref: 'Payment', required: true, index: true })
  payment: Types.ObjectId;

  @Prop({ required: true, min: 1 })
  sequence: number;

  @Prop({ required: true })
  orderId: string;

  @Prop({ required: true })
  campaignId: string;

  @Prop()
  userId?: string;

  @Prop({ required: true, enum: PaymentProviderName })
  provider: PaymentProviderName;

  @Prop({ required: true, enum: PaymentStatus })
  previousStatus: PaymentStatus;

  @Prop({ required: true, enum: PaymentStatus })
  status: PaymentStatus;

  @Prop({ required: true, enum: PaymentEventSource })
  source: PaymentEventSource;

  @Prop({ required: true, min: 1 })
  amountCents: number;

  @Prop({ required: true, enum: PaymentCurrency })
  currency: PaymentCurrency;

  @Prop({ required: true })
  txid: string;

  @Prop()
  endToEndId?: string;

  @Prop({
    required: true,
    enum: PaymentOutboxStatus,
    default: PaymentOutboxStatus.Pending,
    index: true,
  })
  outboxStatus: PaymentOutboxStatus;

  @Prop({ type: [String], default: [] })
  completedSteps: string[];

  @Prop({ required: true, min: 0, default: 0 })
  attempts: number;

  @Prop({ required: true, default: Date.now, index: true })
  nextAttemptAt: Date;

  @Prop()
  lockedAt?: Date;

  @Prop()
  completedAt?: Date;

  @Prop()
  lastError?: string;
}

export const PaymentOutboxEventSchema =
  SchemaFactory.createForClass(PaymentOutboxEvent);
PaymentOutboxEventSchema.index({ outboxStatus: 1, nextAttemptAt: 1 });
PaymentOutboxEventSchema.index({ payment: 1, sequence: -1 });
