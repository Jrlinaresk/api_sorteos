// src/modules/transactions/dto/update-transaction.dto.ts
import { PartialType } from '@nestjs/swagger';
import { CreateTransactionDto } from './create-transaction.dto';
import { ApiProperty } from '@nestjs/swagger';
import { TxStatus } from '../schemas/transaction.schema';

export class UpdateTransactionDto extends PartialType(CreateTransactionDto) {
  @ApiProperty({ enum: TxStatus })
  status?: TxStatus;
}
