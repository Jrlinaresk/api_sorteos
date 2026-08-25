import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsOptional,
  IsString,
  Length,
  Matches,
} from 'class-validator';

export class ConfirmOrderAccessDto {
  @IsString()
  @Length(32, 64)
  @Matches(/^[A-Za-z0-9_-]+$/)
  challengeId: string;

  @IsString()
  @Matches(/^\d{6}$/)
  code: string;

  @ApiPropertyOptional({
    default: false,
    description:
      'Si es true, exige Bearer de CUSTOMER y vincula atómicamente los pedidos recuperados con esa cuenta.',
  })
  @IsOptional()
  @IsBoolean()
  linkToAccount?: boolean = false;
}
