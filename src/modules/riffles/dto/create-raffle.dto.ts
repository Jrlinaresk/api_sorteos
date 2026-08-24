import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsIn,
  IsMongoId,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUrl,
  Length,
  Max,
  MaxLength,
  Matches,
  Min,
  ValidateNested,
  ValidateIf,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { CampaignStatus, DrawMethod, MediaType } from '../schema/raffle.schema';

export class CampaignMediaDto {
  @ValidateIf((item: CampaignMediaDto) => !item.mediaId)
  @IsUrl({ require_tld: false })
  url?: string;

  @ValidateIf((item: CampaignMediaDto) => !item.url)
  @IsMongoId()
  mediaId?: string;

  @IsEnum(MediaType)
  type: MediaType = MediaType.Image;

  @IsOptional()
  @IsString()
  @MaxLength(220)
  alt?: string;

  @IsOptional()
  @IsInt()
  sortOrder = 0;

  @IsOptional()
  @IsBoolean()
  isCover = false;
}

export class PromotionTierDto {
  @IsInt()
  @Min(1)
  quantity: number;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  totalPrice: number;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  label?: string;

  @IsOptional()
  @IsBoolean()
  active = true;
}

export class TimedContentDto {
  @IsBoolean()
  enabled: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @IsOptional()
  @IsDateString()
  startsAt?: string;

  @IsOptional()
  @IsDateString()
  endsAt?: string;
}

export class DoubleChanceDto extends TimedContentDto {
  @IsInt()
  @Min(2)
  @Max(10)
  multiplier = 2;
}

export class ContactsDto {
  @IsOptional()
  @IsString()
  @MaxLength(160)
  instagram?: string;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  telegram?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  whatsapp?: string;
}

export class SeoDto {
  @IsOptional()
  @IsString()
  @MaxLength(180)
  title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(320)
  description?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(30)
  @IsString({ each: true })
  keywords?: string[];

  @IsOptional()
  @IsUrl({ require_tld: false })
  shareImageUrl?: string;
}

export class AnalyticsDto {
  @IsBoolean()
  enabled: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  metaPixelId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  googleTagManagerId?: string;
}

export class FederalLotteryDto {
  @IsInt()
  @Min(1)
  @Max(6)
  firstPrizeDigits = 3;

  @IsInt()
  @Min(0)
  @Max(6)
  secondPrizeDigits = 3;

  @IsIn(['concatenate', 'sum'])
  combination: 'concatenate' | 'sum' = 'concatenate';

  @IsOptional()
  @IsString()
  @Matches(/^[1-9]\d{0,9}$/)
  @MaxLength(10)
  contest?: string;
}

export class ModuleFlagsDto {
  @IsBoolean()
  showProgress = true;

  @IsBoolean()
  showTopBuyers = false;

  @IsBoolean()
  showMinMaxQuota = false;

  @IsBoolean()
  showInstantPrizes = true;

  @IsBoolean()
  showParticipantsDownload = false;

  @IsBoolean()
  showTitleLookup = false;

  @IsBoolean()
  showSocialButtons = true;

  @IsBoolean()
  showCountdown = true;
}

export class GameAttemptTierDto {
  @IsInt()
  @Min(1)
  quantity: number;

  @IsInt()
  @Min(1)
  @Max(100)
  attempts: number;
}

export class InstantGameDto {
  @IsBoolean()
  enabled: boolean;

  @IsIn(['roulette', 'scratch'])
  mechanic: 'roulette' | 'scratch';

  @IsNumber()
  @Min(0)
  noPrizeWeight: number;

  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => GameAttemptTierDto)
  tiers: GameAttemptTierDto[];
}

export class CreateRaffleDto {
  @ApiProperty({ description: 'Nombre público de la campaña' })
  @IsNotEmpty()
  @IsString()
  @MaxLength(180)
  name: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(120)
  slug?: string;

  @IsOptional()
  @IsString()
  @MaxLength(320)
  shortDescription?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200000)
  description?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200000)
  regulationHtml?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  @Matches(/^[A-Za-z0-9._-]+$/)
  termsVersion?: string;

  @IsOptional()
  @IsUrl({ require_tld: false })
  imageUrl?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(30)
  @ValidateNested({ each: true })
  @Type(() => CampaignMediaDto)
  media?: CampaignMediaDto[];

  @IsOptional()
  @IsMongoId()
  category?: string;

  @IsOptional()
  @IsIn(['small', 'medium', 'large'])
  size?: string;

  @IsOptional()
  @IsIn(['low', 'medium', 'high'])
  costLevel?: string;

  @IsOptional()
  @IsEnum(CampaignStatus)
  status?: CampaignStatus;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  statusLabel?: string;

  @IsOptional()
  @IsString()
  @MaxLength(320)
  statusText?: string;

  @ApiProperty({
    description: 'Tamaño total del espacio de números',
    example: 1000000,
  })
  @IsInt()
  @Min(1)
  totalTitles: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(12)
  quotaDigits?: number;

  @IsOptional()
  @IsDateString()
  launchAt?: string;

  @IsOptional()
  @IsDateString()
  closesAt?: string;

  @IsOptional()
  @IsDateString()
  drawDate?: string;

  @IsOptional()
  @IsString()
  @Length(3, 3)
  currency?: string;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  itemPrice: number;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  ticketPrice: number;

  @IsOptional()
  @IsIn(['new', 'used'])
  itemCondition?: 'new' | 'used';

  @IsString()
  @IsNotEmpty()
  @MaxLength(220)
  prizeTitle: string;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  cashAlternative?: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  minimumOrderAmount?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  maxTitlesPerOrder?: number;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(12)
  @IsInt({ each: true })
  @Min(1, { each: true })
  quantitySuggestions?: number[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => PromotionTierDto)
  promotionTiers?: PromotionTierDto[];

  @IsOptional()
  @IsEnum(DrawMethod)
  drawMethod?: DrawMethod;

  @IsOptional()
  @ValidateNested()
  @Type(() => FederalLotteryDto)
  federalLottery?: FederalLotteryDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => ModuleFlagsDto)
  modules?: ModuleFlagsDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => InstantGameDto)
  instantGame?: InstantGameDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => TimedContentDto)
  notice?: TimedContentDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => DoubleChanceDto)
  doubleChance?: DoubleChanceDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => ContactsDto)
  contacts?: ContactsDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => SeoDto)
  seo?: SeoDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => AnalyticsDto)
  analytics?: AnalyticsDto;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100)
  progressOverride?: number;

  @IsOptional()
  @IsBoolean()
  featured?: boolean;

  @IsOptional()
  @IsInt()
  sortOrder?: number;
}
