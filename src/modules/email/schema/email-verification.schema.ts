import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';
import { EmailVerificationPurpose } from '../enums/email-verification-purpose.enum';

export type EmailVerificationDocument = EmailVerification & Document;

@Schema()
export class EmailVerification {
  @Prop({
    required: true,
    index: true,
    unique: true,
    lowercase: true,
    trim: true,
  })
  email: string;

  @Prop({ select: false })
  code?: string;

  @Prop({ required: true, select: false })
  codeHash: string;

  /** HMAC del contexto opaco al que pertenece el código. */
  @Prop({ required: true, select: false })
  bindingHash: string;

  @Prop({ required: true, min: 0, default: 0 })
  attempts: number;

  @Prop({
    type: String,
    enum: Object.values(EmailVerificationPurpose),
    default: EmailVerificationPurpose.Generic,
    required: true,
  })
  purpose: EmailVerificationPurpose;

  @Prop({ type: Date, default: () => new Date(), required: true })
  createdAt: Date;

  /**
   * El índice TTL solo limpia almacenamiento. La validación de seguridad se
   * hace también con `expiresAt > now` porque MongoDB no elimina al instante.
   */
  @Prop({ type: Date, required: true, index: { expires: 0 } })
  expiresAt: Date;
}

export const EmailVerificationSchema =
  SchemaFactory.createForClass(EmailVerification);
