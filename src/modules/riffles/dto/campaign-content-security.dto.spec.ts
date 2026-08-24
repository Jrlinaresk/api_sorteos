import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { VerifyManualDrawDto } from '../../draws/dto/verify-manual-draw.dto';
import { CreateInstantPrizeDto } from '../../prizes/dto/create-instant-prize.dto';
import {
  AnalyticsDto,
  CampaignMediaDto,
  CreateRaffleDto,
  SeoDto,
} from './create-raffle.dto';

async function errorsFor(
  type: new () => object,
  value: Record<string, unknown>,
  property: string,
) {
  const errors = await validate(plainToInstance(type, value));
  return errors.filter((error) => error.property === property);
}

describe('campaign public content security DTOs', () => {
  it.each([
    [CampaignMediaDto, { url: 'http://cdn.example.test/image.jpg' }, 'url'],
    [CampaignMediaDto, { url: 'javascript:alert(1)' }, 'url'],
    [
      SeoDto,
      { shareImageUrl: 'ftp://cdn.example.test/share.jpg' },
      'shareImageUrl',
    ],
    [
      CreateRaffleDto,
      { imageUrl: 'http://cdn.example.test/hero.jpg' },
      'imageUrl',
    ],
    [CreateInstantPrizeDto, { imageUrl: 'data:text/html,x' }, 'imageUrl'],
    [
      VerifyManualDrawDto,
      { evidenceUrl: 'http://example.test/evidence' },
      'evidenceUrl',
    ],
  ] as const)('rechaza URL pública no HTTPS', async (type, value, property) => {
    await expect(errorsFor(type, value, property)).resolves.not.toHaveLength(0);
  });

  it.each([
    [CampaignMediaDto, { url: 'https://cdn.example.test/image.jpg' }, 'url'],
    [
      SeoDto,
      { shareImageUrl: 'https://cdn.example.test/share.jpg' },
      'shareImageUrl',
    ],
    [
      CreateRaffleDto,
      { imageUrl: 'https://cdn.example.test/hero.jpg' },
      'imageUrl',
    ],
    [
      CreateInstantPrizeDto,
      { imageUrl: 'https://cdn.example.test/prize.jpg' },
      'imageUrl',
    ],
    [
      VerifyManualDrawDto,
      { evidenceUrl: 'https://example.test/evidence' },
      'evidenceUrl',
    ],
  ] as const)('acepta URL pública HTTPS', async (type, value, property) => {
    await expect(errorsFor(type, value, property)).resolves.toHaveLength(0);
  });

  it('restringe IDs de analítica al formato que consume el frontend', async () => {
    await expect(
      validate(
        plainToInstance(AnalyticsDto, {
          enabled: true,
          metaPixelId: '\"><script>alert(1)</script>',
          googleTagManagerId: 'GTM-X;alert(1)',
        }),
      ),
    ).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ property: 'metaPixelId' }),
        expect.objectContaining({ property: 'googleTagManagerId' }),
      ]),
    );

    await expect(
      validate(
        plainToInstance(AnalyticsDto, {
          enabled: true,
          metaPixelId: '123456789012345',
          googleTagManagerId: 'GTM-ABC1234',
        }),
      ),
    ).resolves.toHaveLength(0);
  });
});
