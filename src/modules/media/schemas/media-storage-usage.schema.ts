import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type MediaStorageUsageDocument = HydratedDocument<MediaStorageUsage>;

@Schema({ timestamps: true, collection: 'media_storage_usage' })
export class MediaStorageUsage {
  @Prop({ required: true, trim: true, maxlength: 80 })
  scope: string;

  @Prop({ required: true, default: 0, min: 0 })
  bytes: number;

  @Prop({ required: true, default: 0, min: 0 })
  objects: number;

  createdAt: Date;
  updatedAt: Date;
}

export const MediaStorageUsageSchema =
  SchemaFactory.createForClass(MediaStorageUsage);

MediaStorageUsageSchema.index({ scope: 1 }, { unique: true });
