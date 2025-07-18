// src/modules/users/dto/login-user.dto.ts
import { ApiProperty } from '@nestjs/swagger';

export class LoginUserDto {
  @ApiProperty({ description: 'Número de teléfono del usuario' })
  phone: string;

  @ApiProperty({ description: 'Nickname del usuario' })
  nickname: string;
}
