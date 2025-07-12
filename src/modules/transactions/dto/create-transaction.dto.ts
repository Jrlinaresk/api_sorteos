// src/modules/transactions/dto/create-transaction.dto.ts
import { ApiProperty } from '@nestjs/swagger';

export class CreateTransactionDto {
  @ApiProperty({ description: 'ID de usuario' })
  userId: string;

  @ApiProperty({ description: 'Monto en USD que deposita el usuario' })
  amountUsd: number;

  @ApiProperty({ description: 'Método de pago (p.ej. Zelle, BankCUP, ...)' })
  paymentMethod: string;

  @ApiProperty({ description: 'Cuenta o referencia destino' })
  account: string;

  @ApiProperty({ description: 'Tasa bruta (CUP por USD)' })
  rate: number;

  @ApiProperty({
    description: 'Porcentaje de fee aplicado antes de conversión',
  })
  fee: number;

  @ApiProperty({ description: 'Descripción libre' })
  description: string;

  @ApiProperty({
    description: 'Código de confirmación proporcionado por el usuario',
  })
  confirmationCode: string;
}
