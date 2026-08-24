/* src/modules/users/schemas/user.schema.ts */
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import {
  ApiHideProperty,
  ApiProperty,
  ApiPropertyOptional,
} from '@nestjs/swagger';
import { UserRole } from '../enums/user-role.enum';

export type UserDocument = HydratedDocument<User>;

@Schema({ timestamps: true })
export class User {
  @ApiProperty({ description: 'Número de teléfono único del usuario' })
  @Prop({ required: true, unique: true, trim: true, index: true })
  phone: string;

  @ApiProperty({ description: 'Nickname del usuario' })
  @Prop({ required: true, trim: true, maxlength: 50 })
  nickname: string;

  @ApiPropertyOptional({ description: 'Nombre completo' })
  @Prop({ required: false, trim: true, maxlength: 120 })
  name?: string;

  @ApiPropertyOptional({ description: 'CPF sin puntuación' })
  @Prop({ required: false, unique: true, sparse: true, index: true })
  cpf?: string;

  @ApiProperty({ enum: UserRole, default: UserRole.CUSTOMER })
  @Prop({
    type: String,
    enum: Object.values(UserRole),
    default: UserRole.CUSTOMER,
    required: true,
  })
  role: UserRole;

  @ApiProperty({ default: true })
  @Prop({ type: Boolean, default: true, required: true })
  isActive: boolean;

  /**
   * Marca interna para distinguir un alta pública aún no verificada de una
   * cuenta desactivada por administración. Nunca debe exponerse al cliente.
   */
  @ApiHideProperty()
  @Prop({ type: Boolean, default: false, required: true })
  registrationPending: boolean;

  @ApiHideProperty()
  @Prop({ type: Date, required: false })
  registrationPendingExpiresAt?: Date;

  /** Hash SHA-256 del identificador opaco del intento de registro vigente. */
  @ApiHideProperty()
  @Prop({ type: String, required: false, select: false })
  registrationIdHash?: string;

  @ApiProperty({
    description: 'Lista de IDs de rifas en las que participa',
    type: [String],
  })
  @Prop({ type: [Types.ObjectId], ref: 'Raffle', default: [] })
  participations: Types.ObjectId[];

  @ApiProperty({ description: 'Saldo actual del usuario', example: 100.5 })
  @Prop({ required: true, default: 0 })
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

  @ApiHideProperty()
  @Prop({ required: false, select: false })
  passwordHash?: string;

  /** Campo heredado. Nunca se serializa y se elimina al iniciar sesión. */
  @ApiHideProperty()
  @Prop({ required: false, select: false })
  password?: string;

  @ApiHideProperty()
  @Prop({ type: Number, default: 0, select: false })
  failedLoginAttempts?: number;

  @ApiHideProperty()
  @Prop({ type: Date, required: false, select: false })
  lockedUntil?: Date;

  @ApiHideProperty()
  @Prop({ type: Number, required: true, default: 0, min: 0 })
  authVersion: number;

  @ApiProperty({
    description: 'El correo electrónico del cliente.',
    example: 'john@example.com',
    nullable: true,
  })
  @Prop({
    required: false,
    unique: true,
    sparse: true,
    index: true,
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
UserSchema.index({ registrationPending: 1, registrationPendingExpiresAt: 1 });

type SerializedUser = Omit<User, 'authVersion' | 'registrationPending'> & {
  authVersion?: number;
  registrationPending?: boolean;
  __v?: number;
};

function removePrivateFields(
  _document: unknown,
  returned: SerializedUser,
): SerializedUser {
  delete returned.password;
  delete returned.passwordHash;
  delete returned.failedLoginAttempts;
  delete returned.lockedUntil;
  delete returned.authVersion;
  delete returned.registrationPending;
  delete returned.registrationPendingExpiresAt;
  delete returned.registrationIdHash;
  delete returned.__v;
  return returned;
}

UserSchema.set('toJSON', { transform: removePrivateFields });
UserSchema.set('toObject', { transform: removePrivateFields });
