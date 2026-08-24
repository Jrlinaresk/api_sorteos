import {
  IsEmail,
  IsMongoId,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';

export class RequestOrderAccessDto {
  @IsString()
  @MaxLength(32)
  @Matches(/^[+\d\s().-]{8,32}$/)
  phone: string;

  @IsEmail()
  @MaxLength(180)
  email: string;

  @IsOptional()
  @IsMongoId()
  campaignId?: string;
}
