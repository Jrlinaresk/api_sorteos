import { ThemeMode } from '../enums/settings-status.enum';
import {
  SettingsConfiguration,
  SettingsConfigurationPatch,
} from '../interfaces/settings-configuration.interface';

export const DEFAULT_SETTINGS: SettingsConfiguration = {
  brand: {
    siteName: 'Sorteos',
    tagline: 'Elige tu suerte',
  },
  contact: {},
  social: {},
  theme: {
    mode: ThemeMode.DARK,
    primaryColor: '#22C55E',
    secondaryColor: '#111827',
    accentColor: '#F59E0B',
    backgroundColor: '#030712',
  },
  legal: {},
  featureFlags: {
    notifications: true,
    referrals: true,
    instantPrizes: true,
    rankings: true,
    auditLookup: true,
    socialCtas: true,
    pwaInstall: true,
    progressBar: true,
  },
};

export function mergeSettings(
  patch: SettingsConfigurationPatch,
  base: SettingsConfiguration = DEFAULT_SETTINGS,
): SettingsConfiguration {
  return {
    brand: { ...base.brand, ...(patch.brand ?? {}) },
    contact: { ...base.contact, ...(patch.contact ?? {}) },
    social: { ...base.social, ...(patch.social ?? {}) },
    theme: { ...base.theme, ...(patch.theme ?? {}) },
    legal: { ...base.legal, ...(patch.legal ?? {}) },
    featureFlags: {
      ...base.featureFlags,
      ...(patch.featureFlags ?? {}),
    },
  };
}

export function normalizeFeatureFlags(value: unknown): Record<string, boolean> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(
        ([key, flag]) =>
          /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/.test(key) &&
          typeof flag === 'boolean',
      )
      .slice(0, 100) as Array<[string, boolean]>,
  );
}
