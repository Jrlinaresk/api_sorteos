import { Types } from 'mongoose';
import { MediaKind } from './media-types';
import { MediaAsset, MediaAssetStatus } from './schemas/media-asset.schema';

type WithDocumentId<T> = T & {
  _id?: Types.ObjectId | string;
  id?: string;
};

export interface MediaAssetView {
  id: string;
  originalName: string;
  mimeType: string;
  kind: MediaKind;
  extension: string;
  size: number;
  checksumSha256: string;
  status: MediaAssetStatus;
  referenceCount: number;
  publicUrl: string;
  createdAt: Date;
  updatedAt: Date;
}

export function toMediaAssetView(
  asset: WithDocumentId<MediaAsset>,
): MediaAssetView {
  const id = asset.id ?? asset._id?.toString() ?? '';
  return {
    id,
    originalName: asset.originalName,
    mimeType: asset.mimeType,
    kind: asset.kind,
    extension: asset.extension,
    size: asset.size,
    checksumSha256: asset.checksumSha256,
    status: asset.status,
    referenceCount: asset.references?.length ?? 0,
    publicUrl: `/media/${id}`,
    createdAt: asset.createdAt,
    updatedAt: asset.updatedAt,
  };
}
