import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { randomUUID } from 'crypto';
import { Request, Response } from 'express';
import { catchError, from, map, mergeMap, Observable, throwError } from 'rxjs';
import { PublicUserDto } from '../users/dto/public-user.dto';
import { UserRole } from '../users/enums/user-role.enum';
import {
  AUDIT_ACTION_KEY,
  AuditActionOptions,
} from './decorators/audit-action.decorator';
import { AuditService } from './audit.service';
import { AuditCategory, AuditOutcome } from './enums/audit-category.enum';

type AuthenticatedRequest = Request & { user?: PublicUserDto };

@Injectable()
export class AuditInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly auditService: AuditService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const options =
      this.reflector.getAllAndOverride<AuditActionOptions>(AUDIT_ACTION_KEY, [
        context.getHandler(),
        context.getClass(),
      ]) ?? this.automaticOptions(context, request);
    if (!options) return next.handle();

    const http = context.switchToHttp();
    const response = http.getResponse<Response>();
    const correlationId = this.correlationId(request);
    response.setHeader('X-Correlation-Id', correlationId);
    const startedAt = Date.now();
    const base = {
      action: options.action,
      category: options.category,
      resourceType: options.resourceType,
      resourceId: options.resourceIdParam
        ? String(request.params?.[options.resourceIdParam] ?? '') || undefined
        : undefined,
      actorId: request.user?.id,
      actorRole: request.user?.role,
      ip: request.ip,
      userAgent: request.get('user-agent'),
      correlationId,
      before:
        options.captureRequest === false
          ? undefined
          : {
              params: request.params,
              query: request.query,
              body: request.body,
            },
    };

    return next.handle().pipe(
      mergeMap((value) =>
        from(
          this.auditService.tryRecord({
            ...base,
            outcome: AuditOutcome.SUCCESS,
            after: {
              statusCode: response.statusCode,
              durationMs: Date.now() - startedAt,
              result: options.captureResponse ? value : undefined,
            },
          }),
        ).pipe(map(() => value)),
      ),
      catchError((error: unknown) =>
        from(
          this.auditService.tryRecord({
            ...base,
            outcome: AuditOutcome.FAILURE,
            after: {
              statusCode: this.errorStatus(error) ?? response.statusCode,
              durationMs: Date.now() - startedAt,
            },
            errorCode: this.errorCode(error),
            errorMessage: this.auditErrorMessage(error),
          }),
        ).pipe(mergeMap(() => throwError(() => error))),
      ),
    );
  }

  private automaticOptions(
    context: ExecutionContext,
    request: AuthenticatedRequest,
  ): AuditActionOptions | undefined {
    const role = request.user?.role;
    if (role !== UserRole.ADMIN && role !== UserRole.OPERATOR) return undefined;

    const method = request.method.toUpperCase();
    const isMutation = !['GET', 'HEAD', 'OPTIONS'].includes(method);
    const path = request.originalUrl?.split('?')[0] ?? request.path ?? '';
    const isSensitiveRead =
      method === 'GET' &&
      (/\/admin(?:\/|$)/.test(path) || /\/users(?:\/|$)/.test(path));
    if (!isMutation && !isSensitiveRead) return undefined;

    const controller = context.getClass().name.replace(/Controller$/, '');
    const handler = context.getHandler().name;
    const resourceIdParam = ['id', 'publicId', 'campaignId', 'version'].find(
      (name) => request.params?.[name] !== undefined,
    );
    return {
      action: `${controller}.${handler}`.slice(0, 120),
      category: isMutation
        ? AuditCategory.ADMINISTRATION
        : AuditCategory.DATA_ACCESS,
      resourceType: controller || 'administration',
      resourceIdParam,
      captureRequest: true,
      captureResponse: false,
    };
  }

  private correlationId(request: Request): string {
    const provided = request.get('x-correlation-id')?.trim();
    const safe = provided?.replace(/[^A-Za-z0-9._:-]/g, '').slice(0, 100);
    return safe || randomUUID();
  }

  private errorCode(error: unknown): string | undefined {
    if (!error || typeof error !== 'object') return undefined;
    const value = error as { code?: unknown; status?: unknown };
    return value.code
      ? String(value.code)
      : value.status
        ? String(value.status)
        : undefined;
  }

  private errorStatus(error: unknown): number | undefined {
    if (!error || typeof error !== 'object') return undefined;
    const status = (error as { status?: unknown }).status;
    return typeof status === 'number' ? status : undefined;
  }

  private auditErrorMessage(error: unknown): string {
    const status = this.errorStatus(error);
    if (!status || status >= 500) return 'Unexpected internal error';
    return error instanceof Error ? error.message : String(error);
  }
}
