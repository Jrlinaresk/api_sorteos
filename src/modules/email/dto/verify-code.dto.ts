import { ApiProperty } from '@nestjs/swagger';

export class VerifyCodeDto {
  @ApiProperty({ example: 'usuario@dominio.com' })
  email: string;

  @ApiProperty({
    example: 'A1B2C3',
    description: 'Código de 6 caracteres alfanuméricos',
  })
  code: string;
}
