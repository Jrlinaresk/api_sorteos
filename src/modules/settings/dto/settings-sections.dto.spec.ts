import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { SocialSettingsDto } from './settings-sections.dto';

describe('SocialSettingsDto URL safety', () => {
  it('acepta únicamente enlaces HTTPS completos', async () => {
    await expect(
      validate(
        plainToInstance(SocialSettingsDto, {
          instagram: 'https://www.instagram.com/sorteos',
        }),
      ),
    ).resolves.toHaveLength(0);

    for (const instagram of [
      'javascript:alert(1)',
      'http://instagram.com/sorteos',
      '@sorteos',
    ]) {
      await expect(
        validate(plainToInstance(SocialSettingsDto, { instagram })),
      ).resolves.not.toHaveLength(0);
    }
  });
});
