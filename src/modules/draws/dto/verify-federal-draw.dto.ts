import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsOptional,
  IsString,
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
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => AdditionalOutcomeDto)
  additionalOutcomes?: AdditionalOutcomeDto[];
}
