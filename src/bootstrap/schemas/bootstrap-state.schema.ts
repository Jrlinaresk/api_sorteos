import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type BootstrapStateDocument = HydratedDocument<BootstrapState>;

@Schema({
  collection: 'system_bootstrap',
  timestamps: { createdAt: true, updatedAt: false },
  versionKey: false,
})
export class BootstrapState {
  @Prop({ type: String, required: true })
  _id: string;

  @Prop({ type: String, required: true, immutable: true })
  operation: string;

  @Prop({ type: Types.ObjectId, required: true, immutable: true, ref: 'User' })
  userId: Types.ObjectId;

  @Prop({ type: Date, required: true, immutable: true })
  initializedAt: Date;
}

export const BootstrapStateSchema =
  SchemaFactory.createForClass(BootstrapState);
