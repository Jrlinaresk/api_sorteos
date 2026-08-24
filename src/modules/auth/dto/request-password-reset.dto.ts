import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsNotEmpty, Matches, MaxLength } from 'class-validator';

export class RequestPasswordResetDto {
  @ApiProperty({ example: '+5511999999999' })
  @IsNotEmpty()
  @Matches(/^(?=(?:\D*\d){8,15}\D*$)\+?[0-9 ()-]+$/, {
    message: 'El teléfono no tiene un formato válido',
  })
  phone: string;

  @ApiProperty({ example: 'joao@example.com' })
  @IsEmail()
  @MaxLength(150)
  email: string;
}
