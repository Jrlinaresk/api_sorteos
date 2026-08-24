import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsDateString,
  IsOptional,
  IsString,
  IsUrl,
  Matches,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';

export class AdditionalOutcomeDto {
  @IsString()
  @MinLength(1)
  @MaxLength(180)
  prizeTitle: string;

  @IsString()
  @Matches(/^\d+$/)
  @MaxLength(12)
  winningNumber: string;
}

export class VerifyFederalDrawDto {
  @IsString()
  @MaxLength(80)
  contest: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  extraction?: string;

  @IsString()
  @Matches(/^\d+$/)
  @MaxLength(20)
  firstPrize: string;

  @IsString()
  @Matches(/^\d+$/)
  @MaxLength(20)
  secondPrize: string;

  @IsUrl({ require_tld: false })
  sourceUrl: string;

  @IsOptional()
  @IsDateString()
  sourcePublishedAt?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => AdditionalOutcomeDto)
  additionalOutcomes?: AdditionalOutcomeDto[];
}
