import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  Matches,
} from 'class-validator';
import { IsCpf } from '../../users/validators/is-cpf.validator';
import { MaxUtf8Bytes } from '../../users/validators/max-utf8-bytes.validator';

export class RegisterDto {
  @ApiProperty({ example: '+5511999999999' })
  @IsNotEmpty()
  @Matches(/^(?=(?:\D*\d){8,15}\D*$)\+?[0-9 ()-]+$/, {
    message: 'El teléfono no tiene un formato válido',
  })
  phone: string;

  @ApiProperty({ example: 'UnaClave9Segura', minLength: 8, maxLength: 72 })
  @IsString()
  @MinLength(8)
  @MaxLength(72)
  @MaxUtf8Bytes(72)
  @Matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).+$/, {
    message: 'La contraseña debe incluir mayúscula, minúscula y un número',
  })
  password: string;

  @ApiProperty({ example: 'João da Silva' })
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name: string;

  @ApiProperty({ example: '529.982.247-25' })
  @IsNotEmpty()
  @IsCpf()
  cpf: string;

  @ApiProperty({ example: 'joao@example.com' })
  @IsEmail()
  @MaxLength(150)
  email: string;

  @ApiPropertyOptional({ example: 'joao' })
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(50)
  nickname?: string;
}
