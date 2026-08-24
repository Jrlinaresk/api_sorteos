import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type InstantPrizeDocument = HydratedDocument<InstantPrize>;

export enum PrizeMechanic {
  WinningTitle = 'winning_title',
  Roulette = 'roulette',
  Scratch = 'scratch',
}

export enum InstantPrizeStatus {
  Active = 'active',
  Exhausted = 'exhausted',
  Awarded = 'awarded',
  Claimed = 'claimed',
  Fulfilled = 'fulfilled',
  Cancelled = 'cancelled',
}

@Schema({ timestamps: true, collection: 'instant_prizes', optimisticConcurrency: true })
export class InstantPrize {
  @Prop({ type: Types.ObjectId, ref: 'Raffle', required: true, index: true })
  campaign: Types.ObjectId;

  @Prop({ required: true, trim: true, maxlength: 180 })
  title: string;

  @Prop({ trim: true, maxlength: 500 })
  description?: string;

  @Prop({ enum: Object.values(PrizeMechanic), required: true, index: true })
  mechanic: PrizeMechanic;

  @Prop({ trim: true })
  quotaNumber?: string;

  @Prop({ min: 0 })
  cashValue?: number;

  @Prop({ trim: true })
  alternativeTitle?: string;

  @Prop()
  imageUrl?: string;

  @Prop({ type: Types.ObjectId, ref: 'MediaAsset' })
  mediaId?: Types.ObjectId;

  @Prop({ min: 1, default: 1 })
  stock: number;

  @Prop({ min: 0, default: 0 })
  awardedCount: number;

  @Prop({ min: 0, default: 1 })
  weight: number;

  @Prop({ enum: Object.values(InstantPrizeStatus), default: InstantPrizeStatus.Active, index: true })
  status: InstantPrizeStatus;

  @Prop({ type: Types.ObjectId, ref: 'Order', index: true })
  order?: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Quota' })
  quota?: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User', index: true })
  winner?: Types.ObjectId;

  @Prop({ type: { name: String, phone: String }, default: undefined })
  winnerSnapshot?: { name: string; phone: string };

  @Prop()
  awardedAt?: Date;

  @Prop()
  claimedAt?: Date;

  @Prop()
  fulfilledAt?: Date;

  @Prop({ default: 0 })
  sortOrder: number;
}

export const InstantPrizeSchema = SchemaFactory.createForClass(InstantPrize);
InstantPrizeSchema.index(
  { campaign: 1, quotaNumber: 1 },
  {
    unique: true,
    partialFilterExpression: {
      mechanic: PrizeMechanic.WinningTitle,
      quotaNumber: { $type: 'string' },
    },
  },
);
InstantPrizeSchema.index({ campaign: 1, mechanic: 1, status: 1, sortOrder: 1 });
