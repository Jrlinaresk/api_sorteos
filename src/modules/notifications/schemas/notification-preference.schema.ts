import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { HydratedDocument, Types } from 'mongoose';
import { NotificationType } from './notification.schema';

export type NotificationPreferenceDocument =
  HydratedDocument<NotificationPreference>;

@Schema({ timestamps: true, collection: 'notification_preferences' })
export class NotificationPreference {
  @ApiProperty({ description: 'Usuario dueño de las preferencias' })
  @Prop({ type: Types.ObjectId, ref: 'User', required: true, unique: true })
  user: Types.ObjectId;

  @Prop({ required: true, default: true })
  inAppEnabled: boolean;

  @Prop({ required: true, default: false })
  pushEnabled: boolean;

  @Prop({ required: true, default: true })
  transactionalEnabled: boolean;

  @Prop({ required: true, default: false })
  marketingEnabled: boolean;

  @ApiProperty({ enum: NotificationType, isArray: true })
  @Prop({ type: [String], enum: NotificationType, default: [] })
  mutedTypes: NotificationType[];

  @ApiPropertyOptional({ example: '22:00' })
  @Prop({ match: /^([01]\d|2[0-3]):[0-5]\d$/ })
  quietHoursStart?: string;

  @ApiPropertyOptional({ example: '08:00' })
  @Prop({ match: /^([01]\d|2[0-3]):[0-5]\d$/ })
  quietHoursEnd?: string;

  @ApiPropertyOptional({
    description: 'UTC + offset en minutos; São Paulo suele ser -180',
  })
  @Prop({ min: -840, max: 840, default: 0 })
  timezoneOffsetMinutes: number;

  createdAt: Date;
  updatedAt: Date;
}

export const NotificationPreferenceSchema = SchemaFactory.createForClass(
  NotificationPreference,
);
