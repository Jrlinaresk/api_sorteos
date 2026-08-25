import type { CampaignMedia, MediaAsset } from './types';

export interface CampaignMediaFormValue {
  url?: string;
  mediaId?: string;
  type: 'image' | 'video';
  alt: string;
  sortOrder: number;
  isCover: boolean;
}

function normalizedCoverIndex(
  media: Array<Pick<CampaignMediaFormValue, 'isCover'>>,
): number {
  const explicitCover = media.findIndex((item) => item.isCover);
  return explicitCover >= 0 ? explicitCover : media.length ? 0 : -1;
}

export function toCampaignMediaFormValues(
  media?: CampaignMedia[],
): CampaignMediaFormValue[] {
  const ordered = [...(media ?? [])].sort(
    (left, right) => left.sortOrder - right.sortOrder,
  );
  const coverIndex = normalizedCoverIndex(ordered);
  return ordered.map((item, index) => ({
    ...(item.url ? { url: item.url } : {}),
    ...(item.mediaId ? { mediaId: item.mediaId } : {}),
    type: item.type,
    alt: item.alt ?? '',
    sortOrder: index,
    isCover: index === coverIndex,
  }));
}

export function toCampaignMediaPayload(
  media: CampaignMediaFormValue[],
): CampaignMedia[] {
  const coverIndex = normalizedCoverIndex(media);
  return media.map((item, index) => {
    const mediaId = item.mediaId?.trim();
    const url = item.url?.trim();
    const alt = item.alt.trim();
    return {
      ...(mediaId ? { mediaId } : url ? { url } : {}),
      type: item.type,
      ...(alt ? { alt } : {}),
      sortOrder: index,
      isCover: index === coverIndex,
    };
  });
}

export function mediaAssetToCampaignMedia(
  asset: MediaAsset,
  currentCount: number,
): CampaignMediaFormValue {
  return {
    mediaId: asset.id,
    type: asset.kind,
    // Un nombre de archivo no es una descripción accesible. Si el operador no
    // informa el texto, el portal usará el título del premio como alternativa.
    alt: '',
    sortOrder: currentCount,
    isCover: currentCount === 0,
  };
}

export function removeCampaignMediaAt(
  media: CampaignMediaFormValue[],
  removeIndex: number,
): CampaignMediaFormValue[] {
  const removedCover = media[removeIndex]?.isCover ?? false;
  const next = media.filter((_, index) => index !== removeIndex);
  const hasCover = next.some((item) => item.isCover);
  return next.map((item, index) => ({
    ...item,
    sortOrder: index,
    isCover: removedCover && !hasCover ? index === 0 : item.isCover,
  }));
}

export function campaignHasMediaAsset(
  media: CampaignMediaFormValue[],
  mediaId: string,
): boolean {
  return media.some((item) => item.mediaId === mediaId);
}
