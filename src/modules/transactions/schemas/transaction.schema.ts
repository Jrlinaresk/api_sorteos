// src/modules/transactions/schemas/transaction.schema.ts
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';
import { ApiProperty } from '@nestjs/swagger';

export type TransactionDocument = Transaction & Document;

@Schema({ timestamps: true })
export class Transaction {
  @ApiProperty({ description: 'Usuario afectado', type: String })
  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  user: Types.ObjectId;

  @ApiProperty({ description: 'Cantidad (positivo=crédito, negativo=débito)' })
  @Prop({ required: true })
  amount: number;

  @ApiProperty({ description: 'Descripción de la operación' })
  @Prop({ required: true })
  description: string;

  @ApiProperty({ description: 'Saldo resultante tras la operación' })
  @Prop({ required: true })
  resultingBalance: number;
}

export const TransactionSchema = SchemaFactory.createForClass(Transaction);
