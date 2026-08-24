import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsOptional,
  IsString,
  IsUrl,
  Matches,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { AdditionalOutcomeDto } from './verify-federal-draw.dto';

export class VerifyManualDrawDto {
  @IsString()
  @Matches(/^\d+$/)
  @MaxLength(12)
  winningNumber: string;

  @IsUrl({ require_tld: false })
  evidenceUrl: string;

  @IsString()
  @MaxLength(500)
  explanation: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => AdditionalOutcomeDto)
  additionalOutcomes?: AdditionalOutcomeDto[];
}
