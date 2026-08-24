import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type EmailVerificationDocument = EmailVerification & Document;

@Schema()
export class EmailVerification {
  @Prop({ required: true, index: true, unique: true, lowercase: true, trim: true })
  email: string;

  @Prop({ select: false })
  code?: string;

  @Prop({ required: true, select: false })
  codeHash: string;

  @Prop({ required: true, min: 0, default: 0 })
  attempts: number;

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
