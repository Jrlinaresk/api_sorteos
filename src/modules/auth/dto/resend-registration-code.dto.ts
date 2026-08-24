import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsString, Length, Matches, MaxLength } from 'class-validator';

export class ResendRegistrationCodeDto {
  @ApiProperty({
    example: '7F0i_dQ8JjY-yVxYQwA2eKp4Rb1z9N3uHc6LmTsXoPE',
  })
  @IsString()
  @Length(43, 43)
  @Matches(/^[A-Za-z0-9_-]{43}$/, {
    message: 'El identificador de registro no es válido',
  })
  registrationId: string;

  @ApiProperty({ example: 'joao@example.com' })
  @IsEmail()
  @MaxLength(150)
  email: string;
}
