import { ThemeMode } from '../enums/settings-status.enum';

export interface BrandSettings {
  siteName: string;
  legalName?: string;
  tagline?: string;
  logoUrl?: string;
  faviconUrl?: string;
}

export interface ContactSettings {
  supportEmail?: string;
  supportPhone?: string;
  whatsapp?: string;
  address?: string;
}

export interface SocialSettings {
  instagram?: string;
  facebook?: string;
  youtube?: string;
  telegram?: string;
  tiktok?: string;
  x?: string;
}

export interface ThemeSettings {
  mode: ThemeMode;
  primaryColor: string;
  secondaryColor: string;
  accentColor: string;
  backgroundColor: string;
}

export interface LegalSettings {
  privacyPolicyUrl?: string;
  termsUrl?: string;
  responsibleCompany?: string;
  cnpj?: string;
  regulationText?: string;
}

export interface SettingsConfiguration {
  brand: BrandSettings;
  contact: ContactSettings;
  social: SocialSettings;
  theme: ThemeSettings;
  legal: LegalSettings;
  featureFlags: Record<string, boolean>;
}

export interface SettingsConfigurationPatch {
  brand?: Partial<BrandSettings>;
  contact?: Partial<ContactSettings>;
  social?: Partial<SocialSettings>;
  theme?: Partial<ThemeSettings>;
  legal?: Partial<LegalSettings>;
  featureFlags?: Record<string, boolean>;
}
