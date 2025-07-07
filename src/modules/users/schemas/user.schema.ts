/* src/modules/users/schemas/user.schema.ts */
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';
import { ApiProperty } from '@nestjs/swagger';

export type UserDocument = User & Document;

@Schema({ timestamps: true })
export class User {
  @ApiProperty({ description: 'Número de teléfono único del usuario' })
  @Prop({ required: true, unique: true })
  phone: string;

  @ApiProperty({ description: 'Nickname del usuario' })
  @Prop({ required: true })
  nickname: string;

  @ApiProperty({
    description: 'Lista de IDs de rifas en las que participa',
    type: [String],
  })
  @Prop({ type: [Types.ObjectId], ref: 'Raffle', default: [] })
  participations: Types.ObjectId[];
}

export const UserSchema = SchemaFactory.createForClass(User);
