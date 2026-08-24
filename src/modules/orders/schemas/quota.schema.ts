import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type QuotaDocument = HydratedDocument<Quota>;

export enum QuotaStatus {
  Available = 'available',
  Reserved = 'reserved',
  Paid = 'paid',
  Awarded = 'awarded',
  Refunded = 'refunded',
  Cancelled = 'cancelled',
}

@Schema({ timestamps: true, collection: 'quotas', optimisticConcurrency: true })
export class Quota {
  @Prop({ type: Types.ObjectId, ref: 'Raffle', required: true, index: true })
  campaign: Types.ObjectId;

  @Prop({ required: true, min: 0 })
  allocationIndex: number;

  @Prop({ required: true, trim: true })
  number: string;

  @Prop({
    enum: Object.values(QuotaStatus),
    required: true,
    default: QuotaStatus.Reserved,
  })
  status: QuotaStatus;

  @Prop({ type: Types.ObjectId, ref: 'Order', index: true })
  order?: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User', index: true })
  user?: Types.ObjectId;

  @Prop({ index: true })
  reservedUntil?: Date;

  @Prop()
  paidAt?: Date;

  @Prop({ min: 0 })
  unitPrice?: number;

  @Prop({ default: false })
  isBonus: boolean;

  @Prop({ type: Types.ObjectId, ref: 'PrizeAward' })
  instantPrize?: Types.ObjectId;
}

export const QuotaSchema = SchemaFactory.createForClass(Quota);
QuotaSchema.index({ campaign: 1, number: 1 }, { unique: true });
QuotaSchema.index({ campaign: 1, allocationIndex: 1 }, { unique: true });
QuotaSchema.index({ campaign: 1, status: 1, reservedUntil: 1 });
QuotaSchema.index({ user: 1, campaign: 1, createdAt: -1 });
