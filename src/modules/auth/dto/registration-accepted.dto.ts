import { ApiProperty } from '@nestjs/swagger';

export class RegistrationAcceptedDto {
  @ApiProperty({
    example: '7F0i_dQ8JjY-yVxYQwA2eKp4Rb1z9N3uHc6LmTsXoPE',
    description:
      'Identificador opaco del intento. Debe acompañar reenvío y confirmación.',
  })
  registrationId: string;

  @ApiProperty({
    example:
      'Si los datos pueden registrarse, recibirás un código de verificación por correo',
  })
  message: string;

  @ApiProperty({ example: true })
  verificationRequired: true;
}
