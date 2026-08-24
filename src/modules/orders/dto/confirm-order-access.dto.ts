import { IsString, Length, Matches } from 'class-validator';

export class ConfirmOrderAccessDto {
  @IsString()
  @Length(32, 64)
  @Matches(/^[A-Za-z0-9_-]+$/)
  challengeId: string;

  @IsString()
  @Matches(/^\d{6}$/)
  code: string;
}
