import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsDateString,
  IsOptional,
  IsString,
  IsUrl,
  Length,
  Matches,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { AdditionalOutcomeDto } from './verify-federal-draw.dto';

export class CommitCryptographicDrawDto {
  @IsString()
  @Matches(/^[a-f0-9]{64}$/)
  commitment: string;
}

export class VerifyCryptographicDrawDto {
  @IsString()
  @Length(16, 500)
  reveal: string;

  @IsString()
  @Length(8, 500)
  externalEntropy: string;

  @IsUrl({ require_tld: false })
  sourceUrl: string;

  @IsOptional()
  @IsDateString()
  sourcePublishedAt?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  explanation?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => AdditionalOutcomeDto)
  additionalOutcomes?: AdditionalOutcomeDto[];
}
