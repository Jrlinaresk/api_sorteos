import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { HydratedDocument, Types } from 'mongoose';

export enum ReferralCommissionStatus {
  Pending = 'pending',
  Approved = 'approved',
  Paid = 'paid',
  Rejected = 'rejected',
  Reversed = 'reversed',
}

export type ReferralCommissionDocument = HydratedDocument<ReferralCommission>;

@Schema({ timestamps: true, collection: 'referral_commissions' })
export class ReferralCommission {
  @ApiProperty()
  @Prop({ type: Types.ObjectId, ref: 'ReferralCode', required: true })
  referralCode: Types.ObjectId;

  @ApiProperty({ description: 'Copia inmutable del código atribuido' })
  @Prop({ required: true, uppercase: true, trim: true })
  code: string;

  @ApiProperty({ description: 'ID opaco de la orden; único e idempotente' })
  @Prop({ required: true, trim: true, maxlength: 120 })
  orderId: string;

  @ApiPropertyOptional()
  @Prop({ type: Types.ObjectId, ref: 'ReferralClick' })
  click?: Types.ObjectId;

  @ApiPropertyOptional()
  @Prop({ type: Types.ObjectId, ref: 'User' })
  beneficiaryUser?: Types.ObjectId;

  @ApiPropertyOptional()
  @Prop({ type: Types.ObjectId, ref: 'User' })
  buyerUser?: Types.ObjectId;

  @ApiProperty()
  @Prop({ required: true, min: 0 })
  orderAmount: number;

  @ApiProperty()
  @Prop({ required: true, min: 0 })
  commissionBase: number;

  @ApiProperty()
  @Prop({ required: true, min: 0, max: 10_000 })
  commissionRateBps: number;

  @ApiProperty()
  @Prop({ required: true, min: 0 })
  commissionAmount: number;

  @ApiProperty({ example: 'BRL' })
  @Prop({
    required: true,
    uppercase: true,
    trim: true,
    minlength: 3,
    maxlength: 3,
  })
  currency: string;

  @ApiProperty({ enum: ReferralCommissionStatus })
  @Prop({
    required: true,
    enum: ReferralCommissionStatus,
    default: ReferralCommissionStatus.Pending,
  })
  status: ReferralCommissionStatus;

  @Prop({ required: true, default: () => new Date() })
  statusChangedAt: Date;

  @Prop()
  approvedAt?: Date;

  @Prop()
  paidAt?: Date;

  @Prop()
  rejectedAt?: Date;

  @Prop()
  reversedAt?: Date;

  @Prop({ trim: true, maxlength: 500 })
  statusReason?: string;

  @Prop({ type: Object, default: {} })
  metadata: Record<string, unknown>;

  createdAt: Date;
  updatedAt: Date;
}

export const ReferralCommissionSchema =
  SchemaFactory.createForClass(ReferralCommission);

ReferralCommissionSchema.index({ orderId: 1 }, { unique: true });
ReferralCommissionSchema.index({ referralCode: 1, status: 1, createdAt: -1 });
ReferralCommissionSchema.index({
  beneficiaryUser: 1,
  status: 1,
  createdAt: -1,
});
