import {
  SettingsCounterSchema,
  SiteSettingsSchema,
} from './site-settings.schema';

describe('settings schemas', () => {
  it('usa un contador textual y versiones únicas', () => {
    expect(SettingsCounterSchema.path('_id').instance).toBe('String');
    expect(SiteSettingsSchema.path('version').options.unique).toBe(true);
  });

  it('persiste feature flags como mapa booleano', () => {
    expect(SiteSettingsSchema.path('featureFlags').instance).toBe('Map');
  });
});
