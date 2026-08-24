import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { randomUUID } from 'crypto';
import { HydratedDocument, Types } from 'mongoose';

export type MainPrizeAwardDocument = HydratedDocument<MainPrizeAward>;

export enum MainPrizeAwardStatus {
  Pending = 'pending',
  Claimed = 'claimed',
  Fulfilled = 'fulfilled',
}

export enum MainPrizeChoice {
  Physical = 'physical',
  Cash = 'cash',
}

export enum MainPrizeClaimSource {
  Account = 'account',
  OrderToken = 'order_token',
}

/**
 * Contrato operacional del premio principal. El resultado publicado conserva
 * la evidencia del sorteo; este documento conserva, por separado, la entrega
 * al propietario del pedido ganador.
 */
@Schema({
  timestamps: true,
  collection: 'main_prize_awards',
  optimisticConcurrency: true,
})
export class MainPrizeAward {
  @Prop({
    required: true,
    unique: true,
    index: true,
    immutable: true,
    default: () => randomUUID(),
  })
  publicId: string;

  @Prop({
    type: Types.ObjectId,
    ref: 'Raffle',
    required: true,
    unique: true,
    index: true,
    immutable: true,
  })
  campaign: Types.ObjectId;

  @Prop({
    type: Types.ObjectId,
    ref: 'DrawResult',
    required: true,
    unique: true,
    index: true,
    immutable: true,
  })
  drawResult: Types.ObjectId;

  @Prop({
    type: Types.ObjectId,
    ref: 'Quota',
    required: true,
    unique: true,
    index: true,
    immutable: true,
  })
  quota: Types.ObjectId;

  @Prop({
    type: Types.ObjectId,
    ref: 'Order',
    required: true,
    unique: true,
    index: true,
    immutable: true,
  })
  order: Types.ObjectId;

  @Prop({ required: true, immutable: true, trim: true, maxlength: 80 })
  orderPublicId: string;

  @Prop({ type: Types.ObjectId, ref: 'User', index: true, immutable: true })
  user?: Types.ObjectId;

  @Prop({ required: true, immutable: true, trim: true, maxlength: 220 })
  prizeTitle: string;

  @Prop({ min: 0, immutable: true })
  cashAlternative?: number;

  @Prop({
    required: true,
    immutable: true,
    uppercase: true,
    minlength: 3,
    maxlength: 3,
  })
  currency: string;

  @Prop({ required: true, immutable: true, trim: true, maxlength: 32 })
  winningNumber: string;

  @Prop({
    type: {
      name: { type: String, required: true, trim: true, maxlength: 160 },
      phone: { type: String, required: true, trim: true, maxlength: 32 },
      email: { type: String, required: true, trim: true, maxlength: 254 },
    },
    required: true,
    immutable: true,
  })
  winnerSnapshot: { name: string; phone: string; email: string };

  @Prop({
    required: true,
    enum: Object.values(MainPrizeAwardStatus),
    default: MainPrizeAwardStatus.Pending,
    index: true,
  })
  status: MainPrizeAwardStatus;

  @Prop({ enum: Object.values(MainPrizeChoice) })
  choice?: MainPrizeChoice;

  @Prop({ enum: Object.values(MainPrizeClaimSource) })
  claimSource?: MainPrizeClaimSource;

  @Prop({ type: Types.ObjectId, ref: 'User' })
  claimedByUser?: Types.ObjectId;

  @Prop({ required: true, immutable: true, default: Date.now })
  awardedAt: Date;

  @Prop()
  claimedAt?: Date;

  @Prop()
  fulfilledAt?: Date;

  @Prop({ type: Types.ObjectId, ref: 'User' })
  fulfilledBy?: Types.ObjectId;

  @Prop({ trim: true, maxlength: 160 })
  fulfillmentReference?: string;

  @Prop({ trim: true, maxlength: 1_000 })
  fulfillmentNotes?: string;

  /** Marcadores independientes: el registrado recibe inbox y correo. */
  @Prop()
  inboxNotificationQueuedAt?: Date;

  @Prop()
  emailNotificationQueuedAt?: Date;

  @Prop()
  notificationCompletedAt?: Date;

  @Prop({ required: true, min: 0, default: 0 })
  notificationAttempts: number;

  @Prop({ required: true, default: Date.now, index: true })
  notificationNextAttemptAt: Date;

  @Prop({ trim: true, maxlength: 64, select: false })
  notificationLeaseToken?: string;

  @Prop({ select: false })
  notificationLeaseExpiresAt?: Date;

  @Prop({ maxlength: 500 })
  lastNotificationError?: string;

  createdAt: Date;
  updatedAt: Date;
}

export const MainPrizeAwardSchema =
  SchemaFactory.createForClass(MainPrizeAward);

MainPrizeAwardSchema.index({ status: 1, awardedAt: -1 });
MainPrizeAwardSchema.index({ user: 1, awardedAt: -1 });
MainPrizeAwardSchema.index({
  notificationCompletedAt: 1,
  notificationNextAttemptAt: 1,
});
