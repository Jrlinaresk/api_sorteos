import { IsString, Length, Matches } from 'class-validator';

export class CommitCryptographicDrawDto {
  @IsString()
  @Matches(/^[a-f0-9]{64}$/)
  commitment: string;
}

export class VerifyCryptographicDrawDto {
  @IsString()
  @Length(16, 500)
  reveal: string;
}
