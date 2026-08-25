import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type OrderAccessChallengeDocument =
  HydratedDocument<OrderAccessChallenge>;

@Schema({ collection: 'order_access_challenges', versionKey: false })
export class OrderAccessChallenge {
  @Prop({ required: true, unique: true, index: true })
  challengeId: string;

  @Prop({ required: true, select: false })
  codeHash: string;

  @Prop({ required: true, select: false, immutable: true })
  identityHash: string;

  @Prop({
    type: [Types.ObjectId],
    required: true,
    default: [],
    select: false,
  })
  orderIds: Types.ObjectId[];

  @Prop({ required: true, default: false, select: false })
  truncated: boolean;

  @Prop({ type: Types.ObjectId, default: null, select: false })
  campaignId?: Types.ObjectId | null;

  @Prop({ type: [Types.ObjectId], default: [], select: false })
  campaignIds: Types.ObjectId[];

  @Prop({ required: true, min: 0, max: 5, default: 0 })
  attempts: number;

  @Prop({ required: true })
  createdAt: Date;

  @Prop({ required: true })
  expiresAt: Date;
}

export const OrderAccessChallengeSchema =
  SchemaFactory.createForClass(OrderAccessChallenge);
OrderAccessChallengeSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
OrderAccessChallengeSchema.index({ identityHash: 1 }, { unique: true });
