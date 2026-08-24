import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { randomUUID } from 'crypto';
import { HydratedDocument, Types } from 'mongoose';
import { PrizeMechanic } from './instant-prize.schema';

export type PrizeAttemptDocument = HydratedDocument<PrizeAttempt>;

export enum PrizeAttemptStatus {
  Pending = 'pending',
  Played = 'played',
  Expired = 'expired',
}

@Schema({ timestamps: true, collection: 'prize_attempts', optimisticConcurrency: true })
export class PrizeAttempt {
  @Prop({ required: true, unique: true, default: () => randomUUID() })
  publicId: string;

  @Prop({ required: true, select: false })
  accessSecret: string;

  @Prop({ type: Types.ObjectId, ref: 'Raffle', required: true, index: true })
  campaign: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Order', required: true, index: true })
  order: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User', index: true })
  user?: Types.ObjectId;

  @Prop({ enum: [PrizeMechanic.Roulette, PrizeMechanic.Scratch], required: true })
  mechanic: PrizeMechanic.Roulette | PrizeMechanic.Scratch;

  @Prop({ enum: Object.values(PrizeAttemptStatus), default: PrizeAttemptStatus.Pending, index: true })
  status: PrizeAttemptStatus;

  @Prop({ type: Types.ObjectId, ref: 'InstantPrize' })
  prize?: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'PrizeAward' })
  award?: Types.ObjectId;

  @Prop({ required: true, min: 0 })
  ordinal: number;

  @Prop()
  playedAt?: Date;

  @Prop()
  entropyCommitment?: string;

  @Prop({ select: false })
  entropyReveal?: string;
}

export const PrizeAttemptSchema = SchemaFactory.createForClass(PrizeAttempt);
PrizeAttemptSchema.index({ order: 1, status: 1 });
PrizeAttemptSchema.index({ order: 1, ordinal: 1 }, { unique: true });
PrizeAttemptSchema.index({ user: 1, createdAt: -1 });
