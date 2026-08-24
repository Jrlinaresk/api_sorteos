import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { HydratedDocument, Types } from 'mongoose';

export enum ReferralCodeStatus {
  Active = 'active',
  Paused = 'paused',
  Disabled = 'disabled',
}

export type ReferralCodeDocument = HydratedDocument<ReferralCode>;

@Schema({ timestamps: true, collection: 'referral_codes' })
export class ReferralCode {
  @ApiProperty()
  @Prop({
    required: true,
    trim: true,
    uppercase: true,
    minlength: 4,
    maxlength: 32,
  })
  code: string;

  @ApiPropertyOptional({ description: 'Usuario que recibe la comisión' })
  @Prop({ type: Types.ObjectId, ref: 'User' })
  beneficiaryUser?: Types.ObjectId;

  @ApiPropertyOptional()
  @Prop({ trim: true, maxlength: 120 })
  label?: string;

  @ApiProperty({ enum: ReferralCodeStatus })
  @Prop({
    required: true,
    enum: ReferralCodeStatus,
    default: ReferralCodeStatus.Active,
  })
  status: ReferralCodeStatus;

  @ApiProperty({ description: 'Comisión en puntos básicos: 500 = 5%' })
  @Prop({ required: true, min: 0, max: 10_000, default: 0 })
  commissionRateBps: number;

  @ApiProperty({ example: 'BRL' })
  @Prop({
    required: true,
    uppercase: true,
    trim: true,
    minlength: 3,
    maxlength: 3,
  })
  currency: string;

  @ApiPropertyOptional({
    description: 'Restringe el código a una campaña sin acoplar su modelo',
  })
  @Prop({ trim: true, maxlength: 120 })
  campaignId?: string;

  @Prop()
  validFrom?: Date;

  @Prop()
  validUntil?: Date;

  @Prop({ min: 1 })
  maxConversions?: number;

  @Prop({ required: true, min: 0, default: 0 })
  clicksCount: number;

  @Prop({ required: true, min: 0, default: 0 })
  conversionsCount: number;

  @Prop({ type: Object, default: {} })
  metadata: Record<string, unknown>;

  createdAt: Date;
  updatedAt: Date;
}

export const ReferralCodeSchema = SchemaFactory.createForClass(ReferralCode);

ReferralCodeSchema.index({ code: 1 }, { unique: true });
ReferralCodeSchema.index({ beneficiaryUser: 1, status: 1, createdAt: -1 });
ReferralCodeSchema.index({ campaignId: 1, status: 1 });
