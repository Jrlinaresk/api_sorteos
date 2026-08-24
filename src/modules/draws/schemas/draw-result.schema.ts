import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { DrawMethod } from '../../riffles/schema/raffle.schema';

export type DrawResultDocument = HydratedDocument<DrawResult>;

export enum DrawResultStatus {
  Draft = 'draft',
  Verified = 'verified',
  Published = 'published',
  Cancelled = 'cancelled',
}

export interface DrawOutcome {
  position: number;
  prizeTitle: string;
  winningNumber: string;
  quota?: Types.ObjectId;
  order?: Types.ObjectId;
  user?: Types.ObjectId;
  winnerSnapshot?: { name: string; phone: string };
}

@Schema({ timestamps: true, collection: 'draw_results', optimisticConcurrency: true })
export class DrawResult {
  @Prop({ type: Types.ObjectId, ref: 'Raffle', required: true, unique: true, index: true })
  campaign: Types.ObjectId;

  @Prop({ enum: Object.values(DrawMethod), required: true })
  method: DrawMethod;

  @Prop({ enum: Object.values(DrawResultStatus), default: DrawResultStatus.Draft, index: true })
  status: DrawResultStatus;

  @Prop()
  contest?: string;

  @Prop()
  extraction?: string;

  @Prop()
  firstPrize?: string;

  @Prop()
  secondPrize?: string;

  @Prop()
  sourceUrl?: string;

  @Prop()
  sourcePublishedAt?: Date;

  @Prop()
  commitment?: string;

  @Prop()
  revealedSecret?: string;

  @Prop()
  externalEntropy?: string;

  @Prop()
  entropyDigest?: string;

  @Prop({ required: true })
  calculationRule: string;

  @Prop({ required: true })
  evidenceHash: string;

  @Prop({
    type: [
      {
        position: { type: Number, required: true },
        prizeTitle: { type: String, required: true },
        winningNumber: { type: String, required: true },
        quota: { type: Types.ObjectId, ref: 'Quota' },
        order: { type: Types.ObjectId, ref: 'Order' },
        user: { type: Types.ObjectId, ref: 'User' },
        winnerSnapshot: { name: String, phone: String },
      },
    ],
    default: [],
  })
  outcomes: DrawOutcome[];

  @Prop({ type: Object, select: false })
  rawEvidence?: Record<string, unknown>;

  @Prop({ type: Types.ObjectId, ref: 'User' })
  verifiedBy?: Types.ObjectId;

  @Prop()
  verifiedAt?: Date;

  @Prop({ type: Types.ObjectId, ref: 'User' })
  publishedBy?: Types.ObjectId;

  @Prop()
  publishedAt?: Date;
}

export const DrawResultSchema = SchemaFactory.createForClass(DrawResult);
DrawResultSchema.index({ status: 1, publishedAt: -1 });

const immutablePublishedResult = new Error(
  'Un resultado publicado es inmutable y no puede modificarse ni eliminarse',
);

DrawResultSchema.pre('save', async function protectPublishedDocument() {
  if (this.isNew) return;
  const previous = (await this.$model(DrawResult.name)
    .findById(this._id)
    .select('status')
    .lean()) as { status?: DrawResultStatus } | null;
  if (previous?.status === DrawResultStatus.Published) {
    throw immutablePublishedResult;
  }
});

for (const operation of ['findOneAndUpdate', 'findOneAndReplace'] as const) {
  DrawResultSchema.pre(operation, async function protectPublishedQuery() {
    const previous = (await this.model
      .findOne(this.getQuery())
      .select('status')
      .lean()) as { status?: DrawResultStatus } | null;
    if (previous?.status === DrawResultStatus.Published) {
      throw immutablePublishedResult;
    }
  });
}

for (const operation of ['updateOne', 'updateMany', 'replaceOne'] as const) {
  DrawResultSchema.pre(operation, async function protectPublishedUpdate() {
    const published = await this.model.exists({
      $and: [this.getQuery(), { status: DrawResultStatus.Published }],
    });
    if (published) throw immutablePublishedResult;
  });
}

for (const operation of ['deleteOne', 'findOneAndDelete'] as const) {
  DrawResultSchema.pre(operation, async function protectPublishedDelete() {
    const previous = (await this.model
      .findOne(this.getQuery())
      .select('status')
      .lean()) as { status?: DrawResultStatus } | null;
    if (previous?.status === DrawResultStatus.Published) {
      throw immutablePublishedResult;
    }
  });
}

DrawResultSchema.pre('deleteMany', async function protectPublishedDeleteMany() {
  const published = await this.model.exists({
    $and: [this.getQuery(), { status: DrawResultStatus.Published }],
  });
  if (published) throw immutablePublishedResult;
});
