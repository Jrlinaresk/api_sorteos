import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type EmailVerificationDocument = EmailVerification & Document;

@Schema()
export class EmailVerification {
  @Prop({ required: true, index: true })
  email: string;

  @Prop({ required: true })
  code: string;

  // Índice TTL: elimina este documento 15 minutos después de `createdAt`
  @Prop({
    type: Date,
    default: () => new Date(),
    index: { expires: '15m' },
  })
  createdAt: Date;
}

export const EmailVerificationSchema =
  SchemaFactory.createForClass(EmailVerification);
