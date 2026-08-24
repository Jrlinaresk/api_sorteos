import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { HydratedDocument, Types } from 'mongoose';

export enum NotificationType {
  General = 'general',
  Campaign = 'campaign',
  Order = 'order',
  Payment = 'payment',
  Winner = 'winner',
  Promotion = 'promotion',
  System = 'system',
}

export enum NotificationDeliveryStatus {
  Pending = 'pending',
  Skipped = 'skipped',
  Sent = 'sent',
  PartiallySent = 'partially_sent',
  Failed = 'failed',
}

export enum NotificationDeliveryCode {
  NotConfigured = 'not_configured',
  PreferencesBlocked = 'preferences_blocked',
  NoSubscriptions = 'no_subscriptions',
  Delivered = 'delivered',
  PartialFailure = 'partial_failure',
  DeliveryFailed = 'delivery_failed',
}

export type NotificationDocument = HydratedDocument<Notification>;

@Schema({ timestamps: true, collection: 'notifications' })
export class Notification {
  @ApiProperty({ description: 'Usuario propietario de la notificación' })
  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  user: Types.ObjectId;

  @ApiProperty({ description: 'Título corto visible en el inbox' })
  @Prop({ required: true, trim: true, maxlength: 140 })
  title: string;

  @ApiProperty({ description: 'Cuerpo de la notificación' })
  @Prop({ required: true, trim: true, maxlength: 2000 })
  body: string;

  @ApiProperty({ enum: NotificationType })
  @Prop({
    required: true,
    enum: NotificationType,
    default: NotificationType.General,
  })
  type: NotificationType;

  /** Clave interna estable para hacer idempotentes los eventos de negocio. */
  @Prop({ trim: true, maxlength: 160 })
  eventKey?: string;

  @ApiPropertyOptional({ description: 'Datos estructurados para navegación' })
  @Prop({ type: Object, default: {} })
  data: Record<string, unknown>;

  @ApiPropertyOptional()
  @Prop({ trim: true })
  imageUrl?: string;

  @ApiPropertyOptional()
  @Prop({ trim: true })
  actionUrl?: string;

  @ApiPropertyOptional({ description: 'Fecha en la que el usuario la leyó' })
  @Prop()
  readAt?: Date;

  @ApiProperty({ enum: NotificationDeliveryStatus })
  @Prop({
    required: true,
    enum: NotificationDeliveryStatus,
    default: NotificationDeliveryStatus.Pending,
  })
  deliveryStatus: NotificationDeliveryStatus;

  @Prop({ required: true, min: 0, default: 0 })
  deliveryAttempts: number;

  @Prop({ trim: true, maxlength: 40 })
  deliveryProvider?: string;

  @Prop({ trim: true, maxlength: 80 })
  deliveryCode?: string;

  @Prop({ required: true, min: 0, default: 0 })
  deliveryAccepted: number;

  @Prop({ required: true, min: 0, default: 0 })
  deliveryRejected: number;

  @Prop({ required: true, min: 0, default: 0 })
  deliveryInvalidSubscriptions: number;

  @Prop()
  deliveredAt?: Date;

  @Prop({ maxlength: 500 })
  lastDeliveryError?: string;

  @Prop({ trim: true, maxlength: 120 })
  createdBy?: string;

  @ApiPropertyOptional({
    description: 'Si se define, MongoDB elimina el mensaje al expirar',
  })
  @Prop()
  expiresAt?: Date;

  createdAt: Date;
  updatedAt: Date;
}

export const NotificationSchema = SchemaFactory.createForClass(Notification);

NotificationSchema.index({ user: 1, createdAt: -1 });
NotificationSchema.index(
  { user: 1, eventKey: 1 },
  {
    unique: true,
    partialFilterExpression: { eventKey: { $type: 'string' } },
  },
);
NotificationSchema.index({ user: 1, readAt: 1, createdAt: -1 });
NotificationSchema.index({ user: 1, type: 1, createdAt: -1 });
NotificationSchema.index(
  { expiresAt: 1 },
  {
    expireAfterSeconds: 0,
    partialFilterExpression: { expiresAt: { $type: 'date' } },
  },
);
