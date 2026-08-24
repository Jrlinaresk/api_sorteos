import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { MediaKind, SAFE_MEDIA_TYPES } from '../media-types';

export enum MediaAssetStatus {
  Active = 'active',
  Deleted = 'deleted',
  Purging = 'purging',
}

export type MediaAssetDocument = HydratedDocument<MediaAsset>;

@Schema({ timestamps: true, collection: 'media_assets' })
export class MediaAsset {
  @Prop({ required: true, trim: true, maxlength: 80 })
  storageProvider: string;

  @Prop({ required: true, trim: true, maxlength: 512 })
  storageKey: string;

  @Prop({ required: true, trim: true, maxlength: 180 })
  originalName: string;

  @Prop({ required: true, enum: Object.keys(SAFE_MEDIA_TYPES) })
  mimeType: string;

  @Prop({ required: true, enum: MediaKind })
  kind: MediaKind;

  @Prop({ required: true, trim: true, maxlength: 10 })
  extension: string;

  @Prop({ required: true, min: 1 })
  size: number;

  @Prop({ required: true, match: /^[a-f0-9]{64}$/ })
  checksumSha256: string;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  uploadedBy: Types.ObjectId;

  /** Claves opacas, por ejemplo campaign:<id> o prize:<id>. */
  @Prop({ type: [String], default: [] })
  references: string[];

  @Prop({
    required: true,
    enum: MediaAssetStatus,
    default: MediaAssetStatus.Active,
  })
  status: MediaAssetStatus;

  @Prop()
  deletedAt?: Date;

  @Prop({ type: Types.ObjectId, ref: 'User' })
  deletedBy?: Types.ObjectId;

  @Prop()
  purgeRequestedAt?: Date;

  @Prop({ type: Types.ObjectId, ref: 'User' })
  purgeRequestedBy?: Types.ObjectId;

  createdAt: Date;
  updatedAt: Date;
}

export const MediaAssetSchema = SchemaFactory.createForClass(MediaAsset);

MediaAssetSchema.index({ storageProvider: 1, storageKey: 1 }, { unique: true });
MediaAssetSchema.index({ status: 1, createdAt: -1 });
MediaAssetSchema.index({ uploadedBy: 1, createdAt: -1 });
MediaAssetSchema.index({ references: 1 });
