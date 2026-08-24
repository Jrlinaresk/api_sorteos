import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { IsFeatureFlags } from '../validators/is-feature-flags.validator';
import {
  ContactSettingsDto,
  LegalSettingsDto,
  SocialSettingsDto,
  ThemeSettingsDto,
  UpdateBrandSettingsDto,
} from './settings-sections.dto';

export class UpdateSettingsVersionDto {
  @ApiPropertyOptional({ type: UpdateBrandSettingsDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => UpdateBrandSettingsDto)
  brand?: UpdateBrandSettingsDto;

  @ApiPropertyOptional({ type: ContactSettingsDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => ContactSettingsDto)
  contact?: ContactSettingsDto;

  @ApiPropertyOptional({ type: SocialSettingsDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => SocialSettingsDto)
  social?: SocialSettingsDto;

  @ApiPropertyOptional({ type: ThemeSettingsDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => ThemeSettingsDto)
  theme?: ThemeSettingsDto;

  @ApiPropertyOptional({ type: LegalSettingsDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => LegalSettingsDto)
  legal?: LegalSettingsDto;

  @ApiPropertyOptional({
    type: 'object',
    additionalProperties: { type: 'boolean' },
  })
  @IsOptional()
  @IsObject()
  @IsFeatureFlags()
  featureFlags?: Record<string, boolean>;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  changeNote?: string;
}
