import { IsString, IsUrl, Matches, MaxLength } from 'class-validator';

export class VerifyManualDrawDto {
  @IsString()
  @Matches(/^\d+$/)
  @MaxLength(12)
  winningNumber: string;

  @IsUrl({ protocols: ['https'], require_protocol: true })
  evidenceUrl: string;

  @IsString()
  @MaxLength(500)
  explanation: string;
}
