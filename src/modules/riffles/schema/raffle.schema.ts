/* src/modules/raffles/schemas/raffle.schema.ts */
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';
import { ApiProperty } from '@nestjs/swagger';

export type RaffleDocument = Raffle & Document;

@Schema({ timestamps: true })
export class Raffle extends Document {
  @ApiProperty({ description: 'Nombre de la rifa' })
  @Prop({ required: true })
  name: string;

  @ApiProperty({ description: 'Descripción de la rifa', required: false })
  @Prop()
  description?: string;

  @ApiProperty({ description: 'URL de la imagen', required: false })
  @Prop()
  imageUrl?: string;

  @ApiProperty({ description: 'ID de categoría asociada' })
  @Prop({ type: Types.ObjectId, ref: 'Category', required: true })
  category: Types.ObjectId;

  @ApiProperty({
    description: 'Tipo de rifa',
    enum: ['small', 'medium', 'large'],
  })
  @Prop({ required: true, enum: ['small', 'medium', 'large'] })
  size: string;

  @ApiProperty({
    description: 'Nivel de costo',
    enum: ['low', 'medium', 'high'],
  })
  @Prop({ required: true, enum: ['low', 'medium', 'high'] })
  costLevel: string;

  @ApiProperty({
    description: 'Estado de la rifa',
    enum: ['open', 'closed', 'cancelled'],
    default: 'open',
  })
  @Prop({
    required: true,
    enum: ['open', 'closed', 'cancelled'],
    default: 'open',
  })
  status: string;

  @ApiProperty({ description: 'Máximo de participantes' })
  @Prop({ required: true })
  maxParticipants: number;

  @ApiProperty({ description: 'Participantes registrados', type: [String] })
  @Prop({ type: [Types.ObjectId], ref: 'User', default: [] })
  participants: Types.ObjectId[];

  @ApiProperty({
    description: 'Ganadores de la rifa',
    type: [String],
    required: false,
  })
  @Prop({ type: [Types.ObjectId], ref: 'User', default: [] })
  winners?: Types.ObjectId[];

  @ApiProperty({ description: 'Fecha del sorteo', required: false })
  @Prop()
  drawDate?: Date;

  @Prop({ required: true })
  @ApiProperty({ description: 'Precio del artículo rifado' })
  itemPrice: number;

  @Prop({ required: true })
  @ApiProperty({ description: 'Precio del ticket' })
  ticketPrice: number;

  @Prop({ required: true })
  @ApiProperty({
    description: 'Indica si el artículo es nuevo',
    enum: ['new', 'used'],
  })
  itemCondition: 'new' | 'used';
}

export const RaffleSchema = SchemaFactory.createForClass(Raffle);
