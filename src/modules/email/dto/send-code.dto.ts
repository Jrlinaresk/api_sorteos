import { ApiProperty } from '@nestjs/swagger';

export class SendCodeDto {
  @ApiProperty({
    example: 'usuario@dominio.com',
    description: 'Correo a verificar',
  })
  email: string;
}
