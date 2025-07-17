// src/modules/transactions/schemas/transaction.schema.ts
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';
import { ApiProperty } from '@nestjs/swagger';

export type TransactionDocument = Transaction & Document;

export enum TxStatus {
  Pending = 'pending',
  Completed = 'completed',
  Rejected = 'rejected',
}
@Schema({ timestamps: true })
export class Transaction {
  @ApiProperty({ description: 'Usuario afectado', type: String })
  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  user: Types.ObjectId;

  @ApiProperty({ description: 'Método de pago usado' })
  @Prop({ required: true })
  paymentMethod: string;

  @ApiProperty({ description: 'Cantidad en USD (positivo=depósito)' })
  @Prop({ required: true })
  amountUsd: number;

  @ApiProperty({ description: 'Rate en CUP/USD al momento' })
  @Prop({ required: true })
  rate: number;

  @ApiProperty({ description: 'Fee aplicado (%)' })
  @Prop({ required: true })
  fee: number;

  @ApiProperty({ description: 'Monto neto en CUP que recibirá el usuario' })
  @Prop({ required: true })
  netAmountCup: number;

  @ApiProperty({ description: 'Descripción de la operación' })
  @Prop({})
  description?: string;

  @ApiProperty({ description: 'Estado de la transacción', enum: TxStatus })
  @Prop({ required: true, enum: TxStatus, default: TxStatus.Pending })
  status: TxStatus;

  @ApiProperty({ description: 'Saldo resultante tras la operación' })
  @Prop({ required: true })
  resultingBalance: number;

  @ApiProperty({ description: 'Saldo previo a la operación' })
  @Prop({ required: true })
  previousBalance: number;

  @ApiProperty({
    description: 'Código de confirmación proporcionado por el usuario',
  })
  @Prop({ required: false })
  confirmationCode?: string;
}

export const TransactionSchema = SchemaFactory.createForClass(Transaction);
