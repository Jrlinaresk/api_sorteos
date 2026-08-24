import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { ApiProperty } from '@nestjs/swagger';
import { randomInt } from 'crypto';
import { HydratedDocument, Types } from 'mongoose';

export type RaffleDocument = HydratedDocument<Raffle>;

export enum CampaignStatus {
  Draft = 'draft',
  Scheduled = 'scheduled',
  Active = 'active',
  SoldOut = 'sold_out',
  AwaitingDraw = 'awaiting_draw',
  Drawn = 'drawn',
  Closed = 'closed',
  Cancelled = 'cancelled',
  Open = 'open',
}

export enum DrawMethod {
  FederalLottery = 'federal_lottery',
  ManualExternal = 'manual_external',
  Cryptographic = 'cryptographic',
}

export enum MediaType {
  Image = 'image',
  Video = 'video',
}

export interface CampaignMedia {
  url?: string;
  mediaId?: Types.ObjectId;
  type: MediaType;
  alt?: string;
  sortOrder: number;
  isCover: boolean;
}

export interface PromotionTier {
  quantity: number;
  totalPrice: number;
  label?: string;
  active: boolean;
}

export interface TimedContent {
  enabled: boolean;
  title?: string;
  description?: string;
  startsAt?: Date;
  endsAt?: Date;
}

export interface DoubleChanceConfig extends TimedContent {
  multiplier: number;
}

export interface CampaignContacts {
  instagram?: string;
  telegram?: string;
  whatsapp?: string;
}

export interface CampaignSeo {
  title?: string;
  description?: string;
  keywords?: string[];
  shareImageUrl?: string;
}

export interface CampaignAnalytics {
  metaPixelId?: string;
  googleTagManagerId?: string;
  enabled: boolean;
}

export interface RegulationVersion {
  version: string;
  html: string;
  sha256: string;
  publishedAt: Date;
}

export interface FederalLotteryConfig {
  firstPrizeDigits: number;
  secondPrizeDigits: number;
  combination: 'concatenate' | 'sum';
  contest?: string;
  extraction?: string;
  firstPrize?: string;
  secondPrize?: string;
  sourceUrl?: string;
  publishedAt?: Date;
}

export interface CampaignModuleFlags {
  showProgress: boolean;
  showTopBuyers: boolean;
  showMinMaxQuota: boolean;
  showInstantPrizes: boolean;
  showParticipantsDownload: boolean;
  showTitleLookup: boolean;
  showSocialButtons: boolean;
  showCountdown: boolean;
}

export interface GameAttemptTier {
  quantity: number;
  attempts: number;
}

export interface InstantGameConfig {
  enabled: boolean;
  mechanic: 'roulette' | 'scratch';
  noPrizeWeight: number;
  tiers: GameAttemptTier[];
}

function gcd(a: number, b: number): number {
  let x = Math.abs(a);
  let y = Math.abs(b);
  while (y !== 0) {
    const next = x % y;
    x = y;
    y = next;
  }
  return x;
}

export function chooseCoprimeMultiplier(total: number): number {
  if (!Number.isSafeInteger(total) || total < 2) return 1;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const candidate = randomInt(1, total);
    if (gcd(candidate, total) === 1) return candidate;
  }
  for (let candidate = 2; candidate < total; candidate += 1) {
    if (gcd(candidate, total) === 1) return candidate;
  }
  return 1;
}

export function slugifyCampaign(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120);
}

@Schema({ timestamps: true, collection: 'raffles', optimisticConcurrency: true })
export class Raffle {
  @ApiProperty({ description: 'Nombre público de la campaña' })
  @Prop({ required: true, trim: true, maxlength: 180 })
  name: string;

  @ApiProperty({ description: 'Slug público y estable' })
  @Prop({ required: true, unique: true, index: true, lowercase: true, trim: true })
  slug: string;

  @Prop({ trim: true, maxlength: 320 })
  shortDescription?: string;

  @ApiProperty({ description: 'Descripción HTML de la campaña', required: false })
  @Prop()
  description?: string;

  @Prop()
  regulationHtml?: string;

  @Prop({ required: true, default: '1' })
  termsVersion: string;

  @Prop({
    type: [
      {
        version: { type: String, required: true },
        html: { type: String, required: true },
        sha256: { type: String, required: true },
        publishedAt: { type: Date, required: true },
      },
    ],
    default: [],
  })
  regulationHistory: RegulationVersion[];

  @ApiProperty({ description: 'URL de portada heredada', required: false })
  @Prop()
  imageUrl?: string;

  @Prop({
    type: [
      {
        url: String,
        mediaId: { type: Types.ObjectId, ref: 'MediaAsset' },
        type: { type: String, enum: Object.values(MediaType), default: MediaType.Image },
        alt: String,
        sortOrder: { type: Number, default: 0 },
        isCover: { type: Boolean, default: false },
      },
    ],
    default: [],
  })
  media: CampaignMedia[];

  @Prop({ type: Types.ObjectId, ref: 'Category', required: false, index: true })
  category?: Types.ObjectId;

  @Prop({ enum: ['small', 'medium', 'large'], default: 'large' })
  size: string;

  @Prop({ enum: ['low', 'medium', 'high'], default: 'low' })
  costLevel: string;

  @ApiProperty({ enum: CampaignStatus })
  @Prop({
    required: true,
    enum: Object.values(CampaignStatus),
    default: CampaignStatus.Draft,
    index: true,
  })
  status: CampaignStatus;

  @Prop({ default: 'Adquira já!' })
  statusLabel?: string;

  @Prop()
  statusText?: string;

  @Prop({ required: true, min: 1, default: 1000000 })
  totalTitles: number;

  @Prop({ required: true, min: 1, max: 12, default: 6 })
  quotaDigits: number;

  @Prop({ required: true, min: 0, default: 0 })
  allocationCursor: number;

  @Prop({ required: true, min: 1, default: 1 })
  allocationMultiplier: number;

  @Prop({ required: true, min: 0, default: 0 })
  allocationOffset: number;

  @Prop({ required: true, min: 0, default: 0 })
  soldCount: number;

  @Prop({ required: true, min: 0, default: 0 })
  reservedCount: number;

  @Prop({ required: true, min: 1, default: 1000000 })
  maxParticipants: number;

  @Prop({ type: [Types.ObjectId], ref: 'User', default: [], select: false })
  participants: Types.ObjectId[];

  @Prop({ type: [Types.ObjectId], ref: 'User', default: [] })
  winners: Types.ObjectId[];

  @Prop()
  launchAt?: Date;

  @Prop()
  closesAt?: Date;

  @Prop()
  drawDate?: Date;

  @Prop({ required: true, default: 'BRL', uppercase: true, minlength: 3, maxlength: 3 })
  currency: string;

  @Prop({ required: true, min: 0 })
  itemPrice: number;

  @Prop({ required: true, min: 0.01 })
  ticketPrice: number;

  @Prop({ required: true, enum: ['new', 'used'], default: 'new' })
  itemCondition: 'new' | 'used';

  @Prop({ required: true, trim: true })
  prizeTitle: string;

  @Prop({ min: 0 })
  cashAlternative?: number;

  @Prop({ min: 0, default: 2 })
  minimumOrderAmount: number;

  @Prop({ min: 1, default: 20000 })
  maxTitlesPerOrder: number;

  @Prop({ type: [Number], default: [100, 200, 500, 1000, 5000, 10000] })
  quantitySuggestions: number[];

  @Prop({
    type: [
      {
        quantity: { type: Number, required: true, min: 1 },
        totalPrice: { type: Number, required: true, min: 0 },
        label: String,
        active: { type: Boolean, default: true },
      },
    ],
    default: [],
  })
  promotionTiers: PromotionTier[];

  @Prop({ enum: Object.values(DrawMethod), default: DrawMethod.FederalLottery })
  drawMethod: DrawMethod;

  @Prop({ match: /^[a-f0-9]{64}$/ })
  drawCommitment?: string;

  @Prop()
  drawCommittedAt?: Date;

  @Prop({ type: Types.ObjectId, ref: 'User' })
  drawCommittedBy?: Types.ObjectId;

  @Prop({
    type: {
      firstPrizeDigits: { type: Number, default: 3, min: 1, max: 6 },
      secondPrizeDigits: { type: Number, default: 3, min: 0, max: 6 },
      combination: { type: String, enum: ['concatenate', 'sum'], default: 'concatenate' },
      contest: String,
      extraction: String,
      firstPrize: String,
      secondPrize: String,
      sourceUrl: String,
      publishedAt: Date,
    },
    default: () => ({ firstPrizeDigits: 3, secondPrizeDigits: 3, combination: 'concatenate' }),
  })
  federalLottery: FederalLotteryConfig;

  @Prop({
    type: {
      showProgress: { type: Boolean, default: true },
      showTopBuyers: { type: Boolean, default: false },
      showMinMaxQuota: { type: Boolean, default: false },
      showInstantPrizes: { type: Boolean, default: true },
      showParticipantsDownload: { type: Boolean, default: false },
      showTitleLookup: { type: Boolean, default: false },
      showSocialButtons: { type: Boolean, default: true },
      showCountdown: { type: Boolean, default: true },
    },
    default: () => ({}),
  })
  modules: CampaignModuleFlags;

  @Prop({
    type: {
      enabled: { type: Boolean, default: false },
      mechanic: { type: String, enum: ['roulette', 'scratch'], default: 'roulette' },
      noPrizeWeight: { type: Number, min: 0, default: 95 },
      tiers: {
        type: [
          {
            quantity: { type: Number, required: true, min: 1 },
            attempts: { type: Number, required: true, min: 1, max: 100 },
          },
        ],
        default: [],
      },
    },
    default: () => ({ enabled: false, mechanic: 'roulette', noPrizeWeight: 95, tiers: [] }),
  })
  instantGame: InstantGameConfig;

  @Prop({
    type: {
      enabled: { type: Boolean, default: false },
      title: String,
      description: String,
      startsAt: Date,
      endsAt: Date,
    },
    default: () => ({ enabled: false }),
  })
  notice: TimedContent;

  @Prop({
    type: {
      enabled: { type: Boolean, default: false },
      title: String,
      description: String,
      startsAt: Date,
      endsAt: Date,
      multiplier: { type: Number, default: 2, min: 2, max: 10 },
    },
    default: () => ({ enabled: false, multiplier: 2 }),
  })
  doubleChance: DoubleChanceConfig;

  @Prop({ type: { instagram: String, telegram: String, whatsapp: String }, default: () => ({}) })
  contacts: CampaignContacts;

  @Prop({
    type: { title: String, description: String, keywords: [String], shareImageUrl: String },
    default: () => ({}),
  })
  seo: CampaignSeo;

  @Prop({
    type: {
      metaPixelId: String,
      googleTagManagerId: String,
      enabled: { type: Boolean, default: false },
    },
    default: () => ({ enabled: false }),
  })
  analytics: CampaignAnalytics;

  @Prop({ min: 0, max: 100 })
  progressOverride?: number;

  @Prop({ default: false })
  featured: boolean;

  @Prop({ default: 0 })
  sortOrder: number;

  @Prop({ type: Types.ObjectId, ref: 'User' })
  mainWinner?: Types.ObjectId;

  @Prop()
  winningQuotaNumber?: string;

  @Prop()
  resultPublishedAt?: Date;
}

export const RaffleSchema = SchemaFactory.createForClass(Raffle);

RaffleSchema.index({ status: 1, featured: -1, sortOrder: 1, launchAt: -1 });
RaffleSchema.index({ category: 1, status: 1 });
RaffleSchema.index({ name: 'text', shortDescription: 'text', description: 'text' });

RaffleSchema.pre('validate', function prepareCampaign(next) {
  if (!this.slug && this.name) this.slug = slugifyCampaign(this.name);
  if (!this.prizeTitle && this.name) this.prizeTitle = this.name;
  if (!this.totalTitles && this.maxParticipants) this.totalTitles = this.maxParticipants;
  if (!this.maxParticipants && this.totalTitles) this.maxParticipants = this.totalTitles;
  if (!this.quotaDigits && this.totalTitles) {
    this.quotaDigits = Math.max(1, String(Math.max(0, this.totalTitles - 1)).length);
  }
  if (!this.allocationMultiplier || gcd(this.allocationMultiplier, this.totalTitles) !== 1) {
    this.allocationMultiplier = chooseCoprimeMultiplier(this.totalTitles);
  }
  if (this.allocationOffset === undefined || this.allocationOffset === null) {
    this.allocationOffset = this.totalTitles > 1 ? randomInt(0, this.totalTitles) : 0;
  }
  next();
});
