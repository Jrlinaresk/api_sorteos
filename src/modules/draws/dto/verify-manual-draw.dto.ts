import { IsString, IsUrl, Matches, MaxLength } from 'class-validator';

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
}
