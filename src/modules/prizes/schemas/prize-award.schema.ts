import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { randomUUID } from 'crypto';
import { HydratedDocument, Types } from 'mongoose';
import { PrizeMechanic } from './instant-prize.schema';

export type PrizeAwardDocument = HydratedDocument<PrizeAward>;

export enum PrizeAwardStatus {
  Awarded = 'awarded',
  Claimed = 'claimed',
  Fulfilled = 'fulfilled',
  Reversed = 'reversed',
}

@Schema({ timestamps: true, collection: 'prize_awards', optimisticConcurrency: true })
export class PrizeAward {
  @Prop({ required: true, unique: true, index: true, default: () => randomUUID() })
  publicId: string;

  @Prop({ type: Types.ObjectId, ref: 'Raffle', required: true, index: true })
  campaign: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'InstantPrize', required: true, index: true })
  prize: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Order', required: true, index: true })
  order: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Quota' })
  quota?: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'PrizeAttempt' })
  attempt?: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User', index: true })
  user?: Types.ObjectId;

  @Prop({ enum: Object.values(PrizeMechanic), required: true })
  mechanic: PrizeMechanic;

  @Prop({ required: true, trim: true })
  title: string;

  @Prop({ trim: true })
  description?: string;

  @Prop({ min: 0 })
  cashValue?: number;

  @Prop({ trim: true })
  alternativeTitle?: string;

  @Prop()
  imageUrl?: string;

  @Prop({ type: { name: String, phone: String }, required: true })
  winnerSnapshot: { name: string; phone: string };

  @Prop({
    enum: Object.values(PrizeAwardStatus),
    default: PrizeAwardStatus.Awarded,
    index: true,
  })
  status: PrizeAwardStatus;

  @Prop({ required: true, default: Date.now })
  awardedAt: Date;

  @Prop()
  claimedAt?: Date;

  @Prop()
  fulfilledAt?: Date;

  @Prop()
  reversedAt?: Date;
}

export const PrizeAwardSchema = SchemaFactory.createForClass(PrizeAward);
PrizeAwardSchema.index(
  { quota: 1 },
  { unique: true, partialFilterExpression: { quota: { $type: 'objectId' } } },
);
PrizeAwardSchema.index(
  { attempt: 1 },
  { unique: true, partialFilterExpression: { attempt: { $type: 'objectId' } } },
);
PrizeAwardSchema.index({ campaign: 1, status: 1, awardedAt: -1 });
PrizeAwardSchema.index({ user: 1, awardedAt: -1 });
