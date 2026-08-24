import { UserRole } from '../../users/enums/user-role.enum';
import { AuditCategory, AuditOutcome } from '../enums/audit-category.enum';

export interface AuditActorContext {
  actorId?: string;
  actorRole?: UserRole;
  ip?: string;
  userAgent?: string;
  correlationId?: string;
}

export interface AuditEventInput extends AuditActorContext {
  action: string;
  category?: AuditCategory;
  outcome?: AuditOutcome;
  resourceType?: string;
  resourceId?: string;
  before?: unknown;
  after?: unknown;
  metadata?: unknown;
  errorCode?: string;
  errorMessage?: string;
}
