import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { HydratedDocument, Types } from 'mongoose';

export type ReferralClickDocument = HydratedDocument<ReferralClick>;

@Schema({ timestamps: true, collection: 'referral_clicks' })
export class ReferralClick {
  @ApiProperty()
  @Prop({ type: Types.ObjectId, ref: 'ReferralCode', required: true })
  referralCode: Types.ObjectId;

  @ApiProperty({ description: 'Copia inmutable del código usado' })
  @Prop({ required: true, uppercase: true, trim: true })
  code: string;

  @ApiProperty({ description: 'Clave idempotente generada por el cliente' })
  @Prop({ required: true, trim: true, maxlength: 100 })
  eventId: string;

  @ApiPropertyOptional({ description: 'ID anónimo first-party del visitante' })
  @Prop({ trim: true, maxlength: 200 })
  visitorId?: string;

  @ApiPropertyOptional()
  @Prop({ type: Types.ObjectId, ref: 'User' })
  user?: Types.ObjectId;

  @Prop({ trim: true, maxlength: 120 })
  campaignId?: string;

  @Prop({ trim: true, maxlength: 2048 })
  landingPath?: string;

  @Prop({ trim: true, maxlength: 2048 })
  referrer?: string;

  @Prop({ trim: true, maxlength: 200 })
  utmSource?: string;

  @Prop({ trim: true, maxlength: 200 })
  utmMedium?: string;

  @Prop({ trim: true, maxlength: 200 })
  utmCampaign?: string;

  @Prop({ trim: true, maxlength: 200 })
  utmTerm?: string;

  @Prop({ trim: true, maxlength: 200 })
  utmContent?: string;

  @ApiPropertyOptional({ description: 'Hash; nunca la IP en claro' })
  @Prop({ trim: true, maxlength: 200 })
  ipHash?: string;

  @Prop({ trim: true, maxlength: 1000 })
  userAgent?: string;

  @Prop({ trim: true, maxlength: 120 })
  attributedOrderId?: string;

  @Prop()
  convertedAt?: Date;

  @Prop({ type: Object, default: {} })
  metadata: Record<string, unknown>;

  /** Retención técnica del dato de navegación; no afecta la comisión contable. */
  @Prop()
  expiresAt?: Date;

  createdAt: Date;
  updatedAt: Date;
}

export const ReferralClickSchema = SchemaFactory.createForClass(ReferralClick);

ReferralClickSchema.index({ eventId: 1 }, { unique: true });
ReferralClickSchema.index({ referralCode: 1, createdAt: -1 });
ReferralClickSchema.index({ code: 1, visitorId: 1, createdAt: -1 });
ReferralClickSchema.index({ campaignId: 1, createdAt: -1 });
ReferralClickSchema.index({ attributedOrderId: 1 });
ReferralClickSchema.index({ utmCampaign: 1, createdAt: -1 });
ReferralClickSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
