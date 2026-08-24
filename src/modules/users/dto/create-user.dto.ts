/* src/modules/users/dto/create-user.dto.ts */
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEmail,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  Matches,
} from 'class-validator';
import { UserRole } from '../enums/user-role.enum';
import { IsCpf } from '../validators/is-cpf.validator';
import { MaxUtf8Bytes } from '../validators/max-utf8-bytes.validator';

export class CreateUserDto {
  @ApiProperty({
    description: 'Número de teléfono en formato internacional',
    example: '+1234567890',
  })
  @IsNotEmpty()
  @Matches(/^(?=(?:\D*\d){8,15}\D*$)\+?[0-9 ()-]+$/, {
    message:
      'El teléfono debe ser un número válido, preferiblemente en formato internacional',
  })
  phone: string;

  @ApiPropertyOptional({
    description: 'Apodo o nickname del usuario',
    example: 'juanito',
  })
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(50)
  nickname?: string;

  @ApiPropertyOptional({ example: 'Juan Pérez' })
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name?: string;

  @ApiPropertyOptional({ example: '529.982.247-25' })
  @IsOptional()
  @IsCpf()
  cpf?: string;

  @ApiPropertyOptional({ example: 'juan@example.com' })
  @IsOptional()
  @IsEmail()
  @MaxLength(150)
  email?: string;

  @ApiPropertyOptional({
    description:
      'Contraseña; obligatoria al registrarse mediante /auth/register',
    minLength: 8,
    maxLength: 72,
  })
  @IsOptional()
  @IsString()
  @MinLength(8)
  @MaxLength(72)
  @MaxUtf8Bytes(72)
  @Matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).+$/, {
    message: 'La contraseña debe incluir mayúscula, minúscula y un número',
  })
  password?: string;

  @ApiPropertyOptional({ enum: UserRole, default: UserRole.CUSTOMER })
  @IsOptional()
  @IsEnum(UserRole)
  role?: UserRole;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(250)
  address?: string;
}
