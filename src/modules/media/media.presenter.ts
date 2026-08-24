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

export interface AdminMediaAssetView extends MediaAssetView {
  uploadedBy: string;
  references: string[];
  deletedAt?: Date;
  deletedBy?: string;
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
    publicUrl: `/api/v1/media/${id}`,
    createdAt: asset.createdAt,
    updatedAt: asset.updatedAt,
  };
}

export function toAdminMediaAssetView(
  asset: WithDocumentId<MediaAsset>,
): AdminMediaAssetView {
  return {
    ...toMediaAssetView(asset),
    uploadedBy: asset.uploadedBy?.toString() ?? '',
    references: [...(asset.references ?? [])],
    ...(asset.deletedAt ? { deletedAt: asset.deletedAt } : {}),
    ...(asset.deletedBy ? { deletedBy: asset.deletedBy.toString() } : {}),
  };
}
