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

  @ApiProperty({ description: 'Saldo actual del usuario', example: 100.5 })
  @Prop({ required: true, default: 5.5 })
  balance: number;

  // NUEVOS CAMPOS OPCIONALES

  @ApiProperty({
    description: 'Dirección de residencia del usuario',
    nullable: true,
  })
  @Prop({ required: false })
  address?: string;

  @ApiProperty({ description: 'Primer nombre del usuario', nullable: true })
  @Prop({ required: false })
  firstName?: string;

  @ApiProperty({ description: 'Segundo nombre del usuario', nullable: true })
  @Prop({ required: false })
  middleName?: string;

  @ApiProperty({ description: 'Primer apellido del usuario', nullable: true })
  @Prop({ required: false })
  lastName?: string;

  @ApiProperty({ description: 'Segundo apellido del usuario', nullable: true })
  @Prop({ required: false })
  secondLastName?: string;

  @ApiProperty({
    description: 'Indica si el correo electrónico ha sido verificado',
    type: Boolean,
    example: false,
  })
  @Prop({ type: Boolean, default: false, required: false })
  emailVerified: boolean;

  @ApiProperty({
    description: 'La contraseña del cliente.',
    example: 'password123',
  })
  @Prop({ required: false, minlength: 8 })
  password: string;

  @ApiProperty({
    description: 'El correo electrónico del cliente.',
    example: 'john@example.com',
    nullable: true,
  })
  @Prop({
    required: false,
    unique: true,
    index: 1,
    minlength: 5,
    maxlength: 150,
    trim: true,
    lowercase: true,
  })
  email?: string;

  @ApiProperty({ description: 'Foto de perfil del usuario', nullable: true })
  @Prop({ required: false, default: 'https://i.imgur.com/vMppUMs.png' })
  profilePictureUrl?: string;
}

export const UserSchema = SchemaFactory.createForClass(User);
