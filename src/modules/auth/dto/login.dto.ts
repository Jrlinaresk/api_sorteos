import { ApiProperty } from '@nestjs/swagger';
import {
  IsNotEmpty,
  IsString,
  MaxLength,
  MinLength,
  Matches,
} from 'class-validator';
import { MaxUtf8Bytes } from '../../users/validators/max-utf8-bytes.validator';

export class LoginDto {
  @ApiProperty({ example: '+5511999999999' })
  @IsNotEmpty()
  @Matches(/^(?=(?:\D*\d){8,15}\D*$)\+?[0-9 ()-]+$/, {
    message: 'El teléfono no tiene un formato válido',
  })
  phone: string;

  @ApiProperty({ minLength: 8, maxLength: 72 })
  @IsString()
  @MinLength(8)
  @MaxLength(72)
  @MaxUtf8Bytes(72)
  password: string;
}
