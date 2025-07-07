/* src/modules/users/dto/create-user.dto.ts */
import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, Matches } from 'class-validator';

export class CreateUserDto {
  @ApiProperty({
    description: 'Número de teléfono en formato internacional',
    example: '+1234567890',
  })
  @IsNotEmpty()
  @Matches(/^\+[1-9]\d{1,14}$/, {
    message:
      'El número debe empezar con “+” y tener entre 2 y 16 dígitos en total',
  })
  phone: string;

  @ApiProperty({
    description: 'Apodo o nickname del usuario',
    example: 'juanito',
  })
  @IsNotEmpty()
  @IsString()
  nickname: string;
}
