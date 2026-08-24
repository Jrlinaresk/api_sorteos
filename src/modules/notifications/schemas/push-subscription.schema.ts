import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { HydratedDocument, Types } from 'mongoose';

export enum PushProviderKind {
  WebPush = 'web_push',
  Fcm = 'fcm',
  Apns = 'apns',
  Custom = 'custom',
}

export enum PushSubscriptionDisableReason {
  UserUnregistered = 'user_unregistered',
  Expired = 'expired',
  Invalid = 'invalid',
}

export type PushSubscriptionDocument = HydratedDocument<PushSubscription>;

@Schema({ timestamps: true, collection: 'push_subscriptions' })
export class PushSubscription {
  @ApiProperty({ description: 'Usuario dueño de la suscripción' })
  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  user: Types.ObjectId;

  @ApiProperty({ enum: PushProviderKind })
  @Prop({ required: true, enum: PushProviderKind })
  provider: PushProviderKind;

  @ApiProperty({
    description: 'Endpoint Web Push o token opaco del proveedor',
  })
  @Prop({ required: true, trim: true, maxlength: 4096 })
  address: string;

  @ApiPropertyOptional({
    description: 'Claves o datos opacos requeridos por el proveedor',
  })
  @Prop({ type: Object, default: {} })
  credentials: Record<string, string>;

  @ApiPropertyOptional({ description: 'Identificador estable del dispositivo' })
  @Prop({ trim: true, maxlength: 200 })
  deviceId?: string;

  @Prop({ trim: true, maxlength: 30 })
  locale?: string;

  @Prop({ trim: true, maxlength: 100 })
  timezone?: string;

  @Prop({ required: true, default: true })
  enabled: boolean;

  @Prop()
  disabledAt?: Date;

  @Prop({ enum: PushSubscriptionDisableReason })
  disableReason?: PushSubscriptionDisableReason;

  @Prop({ required: true, default: () => new Date() })
  lastSeenAt: Date;

  @Prop()
  expiresAt?: Date;

  @Prop({ type: Object, default: {} })
  metadata: Record<string, unknown>;

  createdAt: Date;
  updatedAt: Date;
}

export const PushSubscriptionSchema =
  SchemaFactory.createForClass(PushSubscription);

PushSubscriptionSchema.index({ provider: 1, address: 1 }, { unique: true });
PushSubscriptionSchema.index({ user: 1, enabled: 1, updatedAt: -1 });
PushSubscriptionSchema.index({ deviceId: 1, user: 1 });
