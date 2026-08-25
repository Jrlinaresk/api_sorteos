import {
  campaignHasMediaAsset,
  mediaAssetToCampaignMedia,
  removeCampaignMediaAt,
  toCampaignMediaFormValues,
  toCampaignMediaPayload,
} from './campaign-media';

describe('campaign media helpers', () => {
  it('ordena la galería recibida y conserva una sola portada', () => {
    expect(
      toCampaignMediaFormValues([
        {
          mediaId: 'second',
          type: 'video',
          sortOrder: 20,
          isCover: true,
        },
        {
          mediaId: 'first',
          type: 'image',
          sortOrder: 10,
          isCover: true,
        },
      ]),
    ).toEqual([
      {
        mediaId: 'first',
        type: 'image',
        alt: '',
        sortOrder: 0,
        isCover: true,
      },
      {
        mediaId: 'second',
        type: 'video',
        alt: '',
        sortOrder: 1,
        isCover: false,
      },
    ]);
  });

  it('envía mediaId o URL heredada y deriva el orden visual', () => {
    expect(
      toCampaignMediaPayload([
        {
          mediaId: ' 507f1f77bcf86cd799439011 ',
          type: 'image',
          alt: '  Vista frontal ',
          sortOrder: 99,
          isCover: false,
        },
        {
          url: ' https://cdn.example.com/prize.mp4 ',
          type: 'video',
          alt: ' ',
          sortOrder: 3,
          isCover: false,
        },
      ]),
    ).toEqual([
      {
        mediaId: '507f1f77bcf86cd799439011',
        type: 'image',
        alt: 'Vista frontal',
        sortOrder: 0,
        isCover: true,
      },
      {
        url: 'https://cdn.example.com/prize.mp4',
        type: 'video',
        sortOrder: 1,
        isCover: false,
      },
    ]);
  });

  it('selecciona activos sin duplicarlos y promueve otra portada al quitarla', () => {
    const first = mediaAssetToCampaignMedia(
      {
        id: 'asset-one',
        originalName: 'premio.webp',
        mimeType: 'image/webp',
        kind: 'image',
        size: 1024,
        status: 'active',
        createdAt: '2026-08-24T00:00:00.000Z',
      },
      0,
    );
    const second = { ...first, mediaId: 'asset-two', isCover: false };

    expect(first.isCover).toBe(true);
    expect(first.alt).toBe('');
    expect(campaignHasMediaAsset([first], 'asset-one')).toBe(true);
    expect(removeCampaignMediaAt([first, second], 0)).toEqual([
      { ...second, sortOrder: 0, isCover: true },
    ]);
  });
});
