import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';
import {
  PaymentCurrency,
  PaymentEventSource,
  PaymentProviderName,
  PaymentStatus,
} from '../payment.enums';

export type PaymentDocument = HydratedDocument<Payment>;

@Schema({ _id: false })
export class PaymentReceipt {
  @Prop({ required: true })
  endToEndId: string;

  @Prop({ required: true, min: 1 })
  amountCents: number;

  @Prop({ required: true })
  paidAt: Date;
}

export const PaymentReceiptSchema =
  SchemaFactory.createForClass(PaymentReceipt);

@Schema({ _id: false })
export class PaymentProviderRefund {
  @Prop({ required: true })
  providerRefundId: string;

  @Prop({ required: true })
  endToEndId: string;

  @Prop({ required: true, min: 1 })
  amountCents: number;

  @Prop({ required: true, enum: PaymentStatus })
  status: PaymentStatus;
}

export const PaymentProviderRefundSchema = SchemaFactory.createForClass(
  PaymentProviderRefund,
);

@Schema({ _id: false })
export class PaymentStatusHistoryEntry {
  @Prop({ required: true, enum: PaymentStatus })
  status: PaymentStatus;

  @Prop({ required: true, enum: PaymentEventSource })
  source: PaymentEventSource;

  @Prop()
  reason?: string;

  @Prop({ type: MongooseSchema.Types.Mixed })
  metadata?: Record<string, unknown>;

  @Prop({ required: true, default: Date.now })
  occurredAt: Date;
}

export const PaymentStatusHistoryEntrySchema = SchemaFactory.createForClass(
  PaymentStatusHistoryEntry,
);

@Schema({ _id: false })
export class PaymentWebhookEvent {
  @Prop({ required: true })
  fingerprint: string;

  @Prop()
  eventId?: string;

  @Prop({ required: true, enum: PaymentProviderName })
  provider: PaymentProviderName;

  @Prop({ required: true, type: MongooseSchema.Types.Mixed })
  payload: Record<string, unknown>;

  @Prop({ required: true, default: Date.now })
  receivedAt: Date;

  @Prop()
  processedAt?: Date;
}

export const PaymentWebhookEventSchema =
  SchemaFactory.createForClass(PaymentWebhookEvent);

@Schema({ _id: false })
export class PaymentRefund {
  @Prop({ required: true })
  idempotencyKey: string;

  @Prop()
  providerRefundId?: string;

  @Prop({ required: true, min: 0.01 })
  amount: number;

  @Prop({ required: true, enum: PaymentStatus })
  status: PaymentStatus;

  @Prop({ type: MongooseSchema.Types.Mixed })
  providerPayload?: Record<string, unknown>;

  @Prop({ required: true, default: Date.now })
  requestedAt: Date;

  @Prop()
  completedAt?: Date;
}

export const PaymentRefundSchema = SchemaFactory.createForClass(PaymentRefund);

@Schema({
  timestamps: true,
  collection: 'payments',
  optimisticConcurrency: true,
})
export class Payment {
  @ApiProperty({ description: 'Pedido al que pertenece el pago' })
  @Prop({ type: Types.ObjectId, ref: 'Order', required: true, index: true })
  order: Types.ObjectId;

  @ApiProperty({ description: 'Campaña a la que pertenece el pedido' })
  @Prop({ type: Types.ObjectId, ref: 'Raffle', required: true, index: true })
  campaign: Types.ObjectId;

  @ApiPropertyOptional({
    description: 'Comprador registrado; ausente para guest',
  })
  @Prop({ type: Types.ObjectId, ref: 'User', index: true })
  user?: Types.ObjectId;

  @ApiProperty({ enum: PaymentStatus })
  @Prop({ required: true, enum: PaymentStatus, default: PaymentStatus.Created })
  status: PaymentStatus;

  @ApiProperty({ enum: PaymentProviderName })
  @Prop({ required: true, enum: PaymentProviderName })
  provider: PaymentProviderName;

  @ApiPropertyOptional({
    description: 'Identificador de la cobranza en el PSP',
  })
  @Prop()
  externalId?: string;

  @ApiProperty({ description: 'Identificador Pix de la cobranza' })
  @Prop({ required: true })
  txid: string;

  @ApiPropertyOptional({ description: 'endToEndId del Pix recibido' })
  @Prop()
  endToEndId?: string;

  @Prop({ type: [String], default: [] })
  endToEndIds: string[];

  @Prop({ type: [PaymentReceiptSchema], default: [] })
  receipts: PaymentReceipt[];

  @Prop({ type: [PaymentProviderRefundSchema], default: [] })
  providerRefunds: PaymentProviderRefund[];

  @ApiPropertyOptional({ description: 'URL/location del QR Pix' })
  @Prop()
  qrCode?: string;

  @ApiPropertyOptional({ description: 'Imagen data URI del QR Pix' })
  @Prop()
  qrCodeImage?: string;

  @ApiPropertyOptional({ description: 'Código Pix copia y pega' })
  @Prop()
  pixCopyPaste?: string;

  @ApiPropertyOptional({ description: 'Página de pago responsiva del PSP' })
  @Prop()
  checkoutUrl?: string;

  @ApiProperty({ description: 'Importe decimal en la moneda indicada' })
  @Prop({ required: true, min: 0.01 })
  amount: number;

  @Prop({ required: true, min: 1 })
  amountCents: number;

  @Prop({ required: true, min: 0, default: 0 })
  receivedAmountCents: number;

  @Prop({ required: true, min: 0, default: 0 })
  refundedAmountCents: number;

  @Prop({ required: true, min: 0, default: 0 })
  refundReservedAmountCents: number;

  @ApiProperty({ enum: PaymentCurrency, default: PaymentCurrency.BRL })
  @Prop({ required: true, enum: PaymentCurrency, default: PaymentCurrency.BRL })
  currency: PaymentCurrency;

  @ApiProperty({ description: 'Clave idempotente creada por OrdersService' })
  @Prop({ required: true })
  idempotencyKey: string;

  @Prop({ required: true, select: false })
  publicSecretHash: string;

  @ApiProperty({ type: String, format: 'date-time' })
  @Prop({ required: true })
  expiresAt: Date;

  @ApiPropertyOptional({ type: String, format: 'date-time' })
  @Prop()
  paidAt?: Date;

  @ApiPropertyOptional({ type: String, format: 'date-time' })
  @Prop()
  cancelledAt?: Date;

  @ApiPropertyOptional({ type: String, format: 'date-time' })
  @Prop()
  refundedAt?: Date;

  @Prop({ default: 0, min: 0 })
  refundedAmount: number;

  @Prop({ required: true, min: 0, default: 0 })
  transitionSequence: number;

  @Prop({ type: MongooseSchema.Types.Mixed })
  providerPayload?: Record<string, unknown>;

  @Prop()
  providerError?: string;

  @Prop()
  lifecycleHookError?: string;

  @Prop()
  lifecycleHookProcessedAt?: Date;

  @Prop({ type: [PaymentStatusHistoryEntrySchema], default: [] })
  statusHistory: PaymentStatusHistoryEntry[];

  @Prop({ type: [PaymentWebhookEventSchema], default: [] })
  webhookPayloads: PaymentWebhookEvent[];

  @Prop({ type: [PaymentRefundSchema], default: [] })
  refunds: PaymentRefund[];

  createdAt?: Date;
  updatedAt?: Date;
}

export const PaymentSchema = SchemaFactory.createForClass(Payment);

PaymentSchema.index({ idempotencyKey: 1 }, { unique: true });
PaymentSchema.index(
  { provider: 1, externalId: 1 },
  {
    unique: true,
    partialFilterExpression: { externalId: { $type: 'string' } },
  },
);
PaymentSchema.index({ provider: 1, txid: 1 }, { unique: true });
PaymentSchema.index({ order: 1, createdAt: -1 });
PaymentSchema.index({ status: 1, expiresAt: 1 });
PaymentSchema.index({ 'webhookPayloads.fingerprint': 1 });
