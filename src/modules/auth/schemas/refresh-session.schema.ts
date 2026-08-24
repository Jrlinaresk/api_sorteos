import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { randomUUID } from 'crypto';
import { HydratedDocument, Types } from 'mongoose';

export type RefreshSessionDocument = HydratedDocument<RefreshSession>;

@Schema({ timestamps: true, collection: 'refresh_sessions' })
export class RefreshSession {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  user: Types.ObjectId;

  /** Versión de seguridad del usuario en el momento de emitir la familia. */
  @Prop({ required: true, min: 0, default: 0 })
  authVersion: number;

  @Prop({ required: true, default: () => randomUUID(), index: true })
  familyId: string;

  @Prop({ required: true, unique: true, index: true })
  tokenHash: string;

  @Prop()
  replacedByTokenHash?: string;

  @Prop({ required: true })
  expiresAt: Date;

  @Prop()
  revokedAt?: Date;

  @Prop({ maxlength: 160 })
  revokeReason?: string;

  /**
   * Se replica en toda la familia cuando se detecta reutilización. A diferencia
   * de `revokedAt`, esta marca también invalida sucesores creados durante una
   * carrera de rotación y evita que vuelvan a ser utilizables más adelante.
   */
  @Prop({ index: true })
  familyCompromisedAt?: Date;

  @Prop({ maxlength: 160 })
  familyCompromiseReason?: string;
}

export const RefreshSessionSchema =
  SchemaFactory.createForClass(RefreshSession);
RefreshSessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
RefreshSessionSchema.index({ user: 1, familyId: 1, revokedAt: 1 });
