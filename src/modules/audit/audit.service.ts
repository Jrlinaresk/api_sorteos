import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { randomUUID } from 'crypto';
import { ClientSession, FilterQuery, Model, Types } from 'mongoose';
import { ListAuditLogsDto } from './dto/list-audit-logs.dto';
import { AuditCategory, AuditOutcome } from './enums/audit-category.enum';
import { AuditEventInput } from './interfaces/audit-event.interface';
import { AuditLog, AuditLogDocument } from './schemas/audit-log.schema';
import { auditLogsToCsv } from './utils/audit-csv';
import { sanitizeAuditText, summarizeAuditValue } from './utils/audit-summary';

const MAX_EXPORT_ROWS = 50_000;

export interface PaginatedAuditLogs {
  data: Array<Record<string, unknown>>;
  meta: { page: number; limit: number; total: number; pages: number };
}

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(
    @InjectModel(AuditLog.name)
    private readonly auditLogModel: Model<AuditLogDocument>,
    private readonly config?: ConfigService,
  ) {}

  async record(
    input: AuditEventInput,
    session?: ClientSession,
  ): Promise<AuditLogDocument> {
    const payload = {
      action: sanitizeAuditText(input.action, 120),
      category: input.category ?? AuditCategory.ADMINISTRATION,
      outcome: input.outcome ?? AuditOutcome.SUCCESS,
      actorId: sanitizeAuditText(input.actorId, 80),
      actorRole: input.actorRole,
      ip: sanitizeAuditText(input.ip, 64),
      userAgent: sanitizeAuditText(input.userAgent, 512),
      resourceType: sanitizeAuditText(input.resourceType, 120),
      resourceId: sanitizeAuditText(input.resourceId, 120),
      correlationId:
        sanitizeAuditText(input.correlationId, 100) ?? randomUUID(),
      before: summarizeAuditValue(input.before),
      after: summarizeAuditValue(input.after),
      metadata: summarizeAuditValue(input.metadata),
      errorCode: sanitizeAuditText(input.errorCode, 100),
      errorMessage: sanitizeAuditText(input.errorMessage, 500),
      expiresAt: new Date(
        Date.now() + this.retentionDays() * 24 * 60 * 60 * 1000,
      ),
    };
    if (session) {
      const [created] = await this.auditLogModel.create([payload], { session });
      return created;
    }
    return this.auditLogModel.create(payload);
  }

  async tryRecord(input: AuditEventInput): Promise<void> {
    try {
      await this.record(input);
    } catch (error) {
      const errorName =
        error instanceof Error && error.name
          ? error.name.replace(/[^A-Za-z0-9_.:-]/g, '').slice(0, 120)
          : 'UnknownError';
      this.logger.error(
        `No se pudo persistir auditoría ${input.action}: ${errorName}`,
      );
    }
  }

  async list(dto: ListAuditLogsDto): Promise<PaginatedAuditLogs> {
    const page = this.boundedInteger(dto.page, 1, 1, Number.MAX_SAFE_INTEGER);
    const limit = this.boundedInteger(dto.limit, 25, 1, 100);
    const filter = this.buildFilter(dto);
    const [rows, total] = await Promise.all([
      this.auditLogModel
        .find(filter)
        .sort({ createdAt: -1, _id: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean()
        .exec(),
      this.auditLogModel.countDocuments(filter).exec(),
    ]);
    return {
      data: rows.map((row) => this.publicView(row)),
      meta: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
    };
  }

  async findOne(id: string): Promise<Record<string, unknown>> {
    if (!Types.ObjectId.isValid(id)) {
      throw new NotFoundException('Evento de auditoría no encontrado');
    }
    const row = await this.auditLogModel.findById(id).lean().exec();
    if (!row) throw new NotFoundException('Evento de auditoría no encontrado');
    return this.publicView(row);
  }

  async exportCsv(dto: ListAuditLogsDto): Promise<string> {
    const rows = await this.auditLogModel
      .find(this.buildFilter(dto))
      .sort({ createdAt: -1, _id: -1 })
      .limit(MAX_EXPORT_ROWS)
      .lean()
      .exec();
    return auditLogsToCsv(
      rows.map((row) => this.publicView(row) as Record<string, unknown>),
    );
  }

  private buildFilter(dto: ListAuditLogsDto): FilterQuery<AuditLog> {
    const filter: FilterQuery<AuditLog> = {};
    if (dto.action) filter.action = dto.action;
    if (dto.category) filter.category = dto.category;
    if (dto.outcome) filter.outcome = dto.outcome;
    if (dto.actorId) filter.actorId = dto.actorId;
    if (dto.actorRole) filter.actorRole = dto.actorRole;
    if (dto.resourceType) filter.resourceType = dto.resourceType;
    if (dto.resourceId) filter.resourceId = dto.resourceId;
    if (dto.correlationId) filter.correlationId = dto.correlationId;
    if (dto.from || dto.to) {
      filter.createdAt = {};
      if (dto.from) filter.createdAt.$gte = new Date(dto.from);
      if (dto.to) filter.createdAt.$lte = new Date(dto.to);
    }
    return filter;
  }

  private publicView(row: Record<string, unknown>): Record<string, unknown> {
    const result = { ...row };
    const id = result._id;
    delete result._id;
    delete result.expiresAt;
    return { ...result, id: String(id) };
  }

  private retentionDays(): number {
    const configured = Number(this.config?.get('AUDIT_RETENTION_DAYS') ?? 365);
    return Number.isSafeInteger(configured)
      ? Math.min(3_650, Math.max(30, configured))
      : 365;
  }

  private boundedInteger(
    value: number | undefined,
    fallback: number,
    minimum: number,
    maximum: number,
  ): number {
    const parsed = Number(value ?? fallback);
    if (!Number.isInteger(parsed)) return fallback;
    return Math.min(maximum, Math.max(minimum, parsed));
  }
}
