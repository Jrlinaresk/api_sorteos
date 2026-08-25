import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { randomBytes, randomUUID } from 'crypto';
import { HydratedDocument, Types } from 'mongoose';

export type OrderDocument = HydratedDocument<Order>;

export enum OrderStatus {
  Reserved = 'reserved',
  PendingPayment = 'pending_payment',
  Paid = 'paid',
  Expired = 'expired',
  Cancelled = 'cancelled',
  Rejected = 'rejected',
  Refunded = 'refunded',
  InReview = 'in_review',
  Disputed = 'disputed',
}

export interface BuyerSnapshot {
  name: string;
  phone: string;
  email: string;
  cpf: string;
}

export interface AttributionSnapshot {
  referralCode?: string;
  referralClickId?: string;
  source?: string;
  medium?: string;
  campaign?: string;
  content?: string;
  term?: string;
  fbclid?: string;
  gclid?: string;
  landingPage?: string;
}

@Schema({ timestamps: true, collection: 'orders', optimisticConcurrency: true })
export class Order {
  @Prop({
    required: true,
    unique: true,
    index: true,
    default: () => randomUUID(),
  })
  publicId: string;

  @Prop({
    required: true,
    select: false,
    default: () => randomBytes(24).toString('hex'),
  })
  accessSecret: string;

  @Prop()
  accessSecretExpiresAt?: Date;

  @Prop({ type: Types.ObjectId, ref: 'Raffle', required: true, index: true })
  campaign: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User', index: true })
  user?: Types.ObjectId;

  @Prop({
    type: {
      name: { type: String, required: true, trim: true },
      phone: { type: String, required: true, trim: true },
      email: { type: String, required: true, trim: true, lowercase: true },
      cpf: { type: String, required: true, trim: true },
    },
    required: true,
  })
  buyer: BuyerSnapshot;

  @Prop({ required: true, min: 1 })
  selectedQuantity: number;

  @Prop({ required: true, min: 0, default: 0 })
  bonusQuantity: number;

  @Prop({ required: true, min: 1 })
  allocatedQuantity: number;

  @Prop({ required: true, min: 0 })
  unitPrice: number;

  @Prop({ required: true, min: 0 })
  subtotal: number;

  @Prop({ required: true, min: 0, default: 0 })
  discount: number;

  @Prop({ required: true, min: 0 })
  total: number;

  @Prop({ required: true, uppercase: true, minlength: 3, maxlength: 3 })
  currency: string;

  @Prop({
    type: { quantity: Number, totalPrice: Number, label: String },
  })
  promotion?: { quantity: number; totalPrice: number; label?: string };

  @Prop({
    required: true,
    enum: Object.values(OrderStatus),
    default: OrderStatus.Reserved,
    index: true,
  })
  status: OrderStatus;

  @Prop({ required: true, default: Date.now })
  reservedAt: Date;

  @Prop({ required: true, index: true })
  expiresAt: Date;

  @Prop()
  paidAt?: Date;

  @Prop()
  cancelledAt?: Date;

  @Prop()
  refundedAt?: Date;

  @Prop({ type: [Types.ObjectId], ref: 'Quota', default: [] })
  quotas: Types.ObjectId[];

  /** Copia inmutable de los números asignados para conservar el historial. */
  @Prop({ type: [String], default: [] })
  titleNumbers: string[];

  @Prop({ type: Types.ObjectId, ref: 'Payment', index: true })
  payment?: Types.ObjectId;

  @Prop({ required: true, trim: true })
  termsVersion: string;

  @Prop({ required: false, match: /^[a-f0-9]{64}$/ })
  termsHash?: string;

  @Prop({ required: true, default: Date.now })
  termsAcceptedAt: Date;

  @Prop({ trim: true })
  idempotencyKey?: string;

  @Prop({
    type: {
      referralCode: String,
      referralClickId: String,
      source: String,
      medium: String,
      campaign: String,
      content: String,
      term: String,
      fbclid: String,
      gclid: String,
      landingPage: String,
    },
    default: () => ({}),
  })
  attribution: AttributionSnapshot;

  @Prop({ type: [Types.ObjectId], ref: 'PrizeAward', default: [] })
  instantPrizes: Types.ObjectId[];

  /**
   * Cerrojo optimista para serializar juego/reclamación de premios con
   * reembolsos que cambian el estado del mismo pedido.
   */
  @Prop({ required: true, min: 0, default: 0, select: false })
  prizeLifecycleVersion: number;

  @Prop({
    type: [{ status: String, at: Date, reason: String, actor: String }],
    default: [],
  })
  statusHistory: Array<{
    status: OrderStatus;
    at: Date;
    reason?: string;
    actor?: string;
  }>;
}

export const OrderSchema = SchemaFactory.createForClass(Order);
OrderSchema.index(
  { user: 1, idempotencyKey: 1 },
  {
    unique: true,
    partialFilterExpression: {
      user: { $type: 'objectId' },
      idempotencyKey: { $type: 'string' },
    },
  },
);
OrderSchema.index(
  { 'buyer.phone': 1, idempotencyKey: 1 },
  {
    unique: true,
    partialFilterExpression: { idempotencyKey: { $type: 'string' } },
  },
);
OrderSchema.index({ 'buyer.phone': 1, createdAt: -1 });
OrderSchema.index({ campaign: 1, status: 1, createdAt: -1 });
OrderSchema.index({ status: 1, expiresAt: 1 });
