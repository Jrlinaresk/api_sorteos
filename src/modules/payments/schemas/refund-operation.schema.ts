import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';

export type RefundOperationDocument = HydratedDocument<RefundOperation>;

export enum RefundOperationStatus {
  Pending = 'pending',
  Succeeded = 'succeeded',
  Failed = 'failed',
}

@Schema({ _id: false })
export class RefundAllocation {
  @Prop({ required: true })
  endToEndId: string;

  @Prop({ required: true, min: 1 })
  amountCents: number;

  @Prop()
  providerRefundId?: string;

  @Prop({ required: true, enum: RefundOperationStatus })
  status: RefundOperationStatus;

  @Prop({ type: MongooseSchema.Types.Mixed })
  providerPayload?: Record<string, unknown>;

  @Prop()
  error?: string;
}

export const RefundAllocationSchema =
  SchemaFactory.createForClass(RefundAllocation);

@Schema({ timestamps: true, collection: 'payment_refund_operations' })
export class RefundOperation {
  @Prop({ type: Types.ObjectId, ref: 'Payment', required: true, index: true })
  payment: Types.ObjectId;

  @Prop({ required: true })
  idempotencyKey: string;

  @Prop({ required: true, min: 1 })
  requestedAmountCents: number;

  @Prop({ required: true, min: 0, default: 0 })
  reservedAmountCents: number;

  @Prop({ required: true, min: 0, default: 0 })
  succeededAmountCents: number;

  @Prop({ required: true, enum: RefundOperationStatus })
  status: RefundOperationStatus;

  @Prop({ type: [RefundAllocationSchema], default: [] })
  allocations: RefundAllocation[];

  @Prop()
  reason?: string;

  @Prop()
  lastError?: string;

  @Prop()
  completedAt?: Date;
}

export const RefundOperationSchema =
  SchemaFactory.createForClass(RefundOperation);
RefundOperationSchema.index(
  { payment: 1, idempotencyKey: 1 },
  { unique: true },
);
RefundOperationSchema.index({ payment: 1, status: 1, createdAt: -1 });
