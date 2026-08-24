import { ThemeMode } from '../enums/settings-status.enum';
import {
  DEFAULT_SETTINGS,
  mergeSettings,
  normalizeFeatureFlags,
} from './settings-defaults';

describe('settings defaults', () => {
  it('fusiona por sección sin perder valores predeterminados', () => {
    const result = mergeSettings({
      brand: { siteName: 'ZERO7' },
      theme: { mode: ThemeMode.LIGHT },
      featureFlags: { instantPrizes: false },
    });

    expect(result.brand.siteName).toBe('ZERO7');
    expect(result.theme.mode).toBe(ThemeMode.LIGHT);
    expect(result.theme.primaryColor).toBe(DEFAULT_SETTINGS.theme.primaryColor);
    expect(result.featureFlags.instantPrizes).toBe(false);
    expect(result.featureFlags.notifications).toBe(true);
  });

  it('descarta feature flags inválidos', () => {
    expect(
      normalizeFeatureFlags({ validFlag: true, bad: 'yes', '': false }),
    ).toEqual({ validFlag: true });
  });
});
