import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';
import {
  SettingsVersionStatus,
  ThemeMode,
} from '../enums/settings-status.enum';

@Schema({ _id: false })
export class BrandSettingsSchemaClass {
  @Prop({ required: true, trim: true, maxlength: 100 })
  siteName: string;

  @Prop({ trim: true, maxlength: 180 })
  legalName?: string;

  @Prop({ trim: true, maxlength: 250 })
  tagline?: string;

  @Prop({ trim: true, maxlength: 1000 })
  logoUrl?: string;

  @Prop({ trim: true, maxlength: 1000 })
  faviconUrl?: string;
}
const BrandSettingsSchema = SchemaFactory.createForClass(
  BrandSettingsSchemaClass,
);

@Schema({ _id: false })
export class ContactSettingsSchemaClass {
  @Prop({ trim: true, lowercase: true, maxlength: 150 })
  supportEmail?: string;

  @Prop({ trim: true, maxlength: 30 })
  supportPhone?: string;

  @Prop({ trim: true, maxlength: 100 })
  whatsapp?: string;

  @Prop({ trim: true, maxlength: 500 })
  address?: string;
}
const ContactSettingsSchema = SchemaFactory.createForClass(
  ContactSettingsSchemaClass,
);

@Schema({ _id: false })
export class SocialSettingsSchemaClass {
  @Prop({ trim: true, maxlength: 300 })
  instagram?: string;
  @Prop({ trim: true, maxlength: 300 })
  facebook?: string;
  @Prop({ trim: true, maxlength: 300 })
  youtube?: string;
  @Prop({ trim: true, maxlength: 300 })
  telegram?: string;
  @Prop({ trim: true, maxlength: 300 })
  tiktok?: string;
  @Prop({ trim: true, maxlength: 300 })
  x?: string;
}
const SocialSettingsSchema = SchemaFactory.createForClass(
  SocialSettingsSchemaClass,
);

@Schema({ _id: false })
export class ThemeSettingsSchemaClass {
  @Prop({
    type: String,
    enum: Object.values(ThemeMode),
    default: ThemeMode.DARK,
  })
  mode: ThemeMode;

  @Prop({ required: true })
  primaryColor: string;
  @Prop({ required: true })
  secondaryColor: string;
  @Prop({ required: true })
  accentColor: string;
  @Prop({ required: true })
  backgroundColor: string;
}
const ThemeSettingsSchema = SchemaFactory.createForClass(
  ThemeSettingsSchemaClass,
);

@Schema({ _id: false })
export class LegalSettingsSchemaClass {
  @Prop({ trim: true, maxlength: 1000 })
  privacyPolicyUrl?: string;
  @Prop({ trim: true, maxlength: 1000 })
  termsUrl?: string;
  @Prop({ trim: true, maxlength: 180 })
  responsibleCompany?: string;
  @Prop({ trim: true, maxlength: 18 })
  cnpj?: string;
  @Prop({ maxlength: 50_000 })
  regulationText?: string;
}
const LegalSettingsSchema = SchemaFactory.createForClass(
  LegalSettingsSchemaClass,
);

export type SiteSettingsDocument = HydratedDocument<SiteSettings>;

@Schema({
  collection: 'site_settings_versions',
  timestamps: true,
  versionKey: false,
})
export class SiteSettings {
  @Prop({ required: true, unique: true, index: true, immutable: true })
  version: number;

  @Prop({
    type: String,
    enum: Object.values(SettingsVersionStatus),
    default: SettingsVersionStatus.DRAFT,
    index: true,
  })
  status: SettingsVersionStatus;

  @Prop({ type: BrandSettingsSchema, required: true })
  brand: BrandSettingsSchemaClass;

  @Prop({ type: ContactSettingsSchema, default: {} })
  contact: ContactSettingsSchemaClass;

  @Prop({ type: SocialSettingsSchema, default: {} })
  social: SocialSettingsSchemaClass;

  @Prop({ type: ThemeSettingsSchema, required: true })
  theme: ThemeSettingsSchemaClass;

  @Prop({ type: LegalSettingsSchema, default: {} })
  legal: LegalSettingsSchemaClass;

  @Prop({ type: Map, of: Boolean, default: {} })
  featureFlags: Record<string, boolean>;

  @Prop({ required: true, immutable: true, index: true, maxlength: 80 })
  createdBy: string;

  @Prop({ trim: true, maxlength: 500 })
  changeNote?: string;

  @Prop({ maxlength: 80 })
  publishedBy?: string;

  @Prop()
  publishedAt?: Date;

  createdAt: Date;
  updatedAt: Date;
}

export const SiteSettingsSchema = SchemaFactory.createForClass(SiteSettings);
SiteSettingsSchema.index({ status: 1, version: -1 });

export type SettingsCounterDocument = HydratedDocument<SettingsCounter>;

@Schema({ collection: 'settings_counters', versionKey: false })
export class SettingsCounter {
  @Prop({ required: true })
  _id: string;

  @Prop({ type: Number, default: 0 })
  nextVersion: number;

  @Prop({ type: Number, required: false })
  publishedVersion?: number;
}

export const SettingsCounterSchema =
  SchemaFactory.createForClass(SettingsCounter);
