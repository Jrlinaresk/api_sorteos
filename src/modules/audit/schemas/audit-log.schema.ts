import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema } from 'mongoose';
import { UserRole } from '../../users/enums/user-role.enum';
import { AuditCategory, AuditOutcome } from '../enums/audit-category.enum';

export type AuditLogDocument = HydratedDocument<AuditLog>;

@Schema({
  collection: 'audit_logs',
  timestamps: { createdAt: true, updatedAt: false },
  versionKey: false,
})
export class AuditLog {
  @Prop({ required: true, immutable: true, trim: true, maxlength: 120 })
  action: string;

  @Prop({
    type: String,
    enum: Object.values(AuditCategory),
    default: AuditCategory.ADMINISTRATION,
    immutable: true,
    index: true,
  })
  category: AuditCategory;

  @Prop({ required: false, immutable: true, index: true, maxlength: 80 })
  actorId?: string;

  @Prop({
    type: String,
    enum: Object.values(UserRole),
    required: false,
    immutable: true,
    index: true,
  })
  actorRole?: UserRole;

  @Prop({ required: false, immutable: true, maxlength: 64 })
  ip?: string;

  @Prop({ required: false, immutable: true, maxlength: 512 })
  userAgent?: string;

  @Prop({ required: false, immutable: true, index: true, maxlength: 120 })
  resourceType?: string;

  @Prop({ required: false, immutable: true, index: true, maxlength: 120 })
  resourceId?: string;

  @Prop({ type: MongooseSchema.Types.Mixed, immutable: true })
  before?: unknown;

  @Prop({ type: MongooseSchema.Types.Mixed, immutable: true })
  after?: unknown;

  @Prop({ type: MongooseSchema.Types.Mixed, immutable: true })
  metadata?: unknown;

  @Prop({ required: true, immutable: true, index: true, maxlength: 100 })
  correlationId: string;

  @Prop({
    type: String,
    enum: Object.values(AuditOutcome),
    default: AuditOutcome.SUCCESS,
    immutable: true,
    index: true,
  })
  outcome: AuditOutcome;

  @Prop({ required: false, immutable: true, maxlength: 100 })
  errorCode?: string;

  @Prop({ required: false, immutable: true, maxlength: 500 })
  errorMessage?: string;

  @Prop({ required: true, immutable: true, select: false })
  expiresAt: Date;

  createdAt: Date;
}

export const AuditLogSchema = SchemaFactory.createForClass(AuditLog);

AuditLogSchema.index({ createdAt: -1, category: 1 });
AuditLogSchema.index({ resourceType: 1, resourceId: 1, createdAt: -1 });
AuditLogSchema.index({ actorId: 1, createdAt: -1 });
AuditLogSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

const appendOnlyError = new Error(
  'Los eventos de auditoría son append-only y no pueden modificarse ni eliminarse',
);

AuditLogSchema.pre('save', function rejectExistingDocument(next) {
  if (!this.isNew) return next(appendOnlyError);
  return next();
});
AuditLogSchema.pre('updateOne', function rejectUpdate(next) {
  next(appendOnlyError);
});
AuditLogSchema.pre('updateMany', function rejectUpdate(next) {
  next(appendOnlyError);
});
AuditLogSchema.pre('findOneAndUpdate', function rejectUpdate(next) {
  next(appendOnlyError);
});
AuditLogSchema.pre('replaceOne', function rejectUpdate(next) {
  next(appendOnlyError);
});
AuditLogSchema.pre('findOneAndReplace', function rejectUpdate(next) {
  next(appendOnlyError);
});
AuditLogSchema.pre('deleteOne', function rejectDelete(next) {
  next(appendOnlyError);
});
AuditLogSchema.pre(
  'deleteOne',
  { document: true, query: false },
  function rejectDocumentDelete(next) {
    next(appendOnlyError);
  },
);
AuditLogSchema.pre('deleteMany', function rejectDelete(next) {
  next(appendOnlyError);
});
AuditLogSchema.pre('findOneAndDelete', function rejectDelete(next) {
  next(appendOnlyError);
});
AuditLogSchema.pre('bulkWrite', function rejectBulkMutation(next, operations) {
  if (operations.some((operation) => !('insertOne' in operation))) {
    return next(appendOnlyError);
  }
  return next();
});
