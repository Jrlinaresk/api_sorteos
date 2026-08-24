import { SetMetadata } from '@nestjs/common';
import { AuditCategory } from '../enums/audit-category.enum';

export const AUDIT_ACTION_KEY = 'audit:action';

export interface AuditActionOptions {
  action: string;
  category?: AuditCategory;
  resourceType?: string;
  resourceIdParam?: string;
  captureRequest?: boolean;
  captureResponse?: boolean;
}

export const AuditAction = (options: AuditActionOptions) =>
  SetMetadata(AUDIT_ACTION_KEY, options);
