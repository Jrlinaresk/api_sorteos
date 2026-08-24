import {
  ConflictException,
  Injectable,
  NotFoundException,
  Optional,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { ClientSession, Connection, FilterQuery, Model } from 'mongoose';
import { AuditService } from '../audit/audit.service';
import { AuditCategory } from '../audit/enums/audit-category.enum';
import { AuditActorContext } from '../audit/interfaces/audit-event.interface';
import { CreateSettingsVersionDto } from './dto/create-settings-version.dto';
import { ListSettingsVersionsDto } from './dto/list-settings-versions.dto';
import { UpdateSettingsVersionDto } from './dto/update-settings-version.dto';
import { SettingsVersionStatus } from './enums/settings-status.enum';
import {
  SettingsConfiguration,
  SettingsConfigurationPatch,
} from './interfaces/settings-configuration.interface';
import {
  SettingsCounter,
  SettingsCounterDocument,
  SiteSettings,
  SiteSettingsDocument,
} from './schemas/site-settings.schema';
import {
  DEFAULT_SETTINGS,
  mergeSettings,
  normalizeFeatureFlags,
} from './utils/settings-defaults';

const SETTINGS_COUNTER_ID = 'site-settings';

export interface PublicSettingsView extends SettingsConfiguration {
  version: number;
  publishedAt: Date | null;
}

export interface PaginatedSettingsVersions {
  data: Array<Record<string, unknown>>;
  meta: { page: number; limit: number; total: number; pages: number };
}

@Injectable()
export class SettingsService {
  constructor(
    @InjectModel(SiteSettings.name)
    private readonly settingsModel: Model<SiteSettingsDocument>,
    @InjectModel(SettingsCounter.name)
    private readonly counterModel: Model<SettingsCounterDocument>,
    private readonly auditService: AuditService,
    @Optional()
    @InjectConnection()
    private readonly connection?: Connection,
  ) {}

  async getPublic(): Promise<PublicSettingsView> {
    const counter = await this.counterModel
      .findById(SETTINGS_COUNTER_ID)
      .lean()
      .exec();
    let row: Record<string, unknown> | null = null;
    if (counter?.publishedVersion) {
      row = (await this.settingsModel
        .findOne({
          version: counter.publishedVersion,
          status: SettingsVersionStatus.PUBLISHED,
        })
        .lean({ flattenMaps: true })
        .exec()) as unknown as Record<string, unknown> | null;
    }
    if (!row) {
      row = (await this.settingsModel
        .findOne({ status: SettingsVersionStatus.PUBLISHED })
        .sort({ version: -1 })
        .lean({ flattenMaps: true })
        .exec()) as unknown as Record<string, unknown> | null;
    }
    if (!row) {
      return {
        ...mergeSettings({}, DEFAULT_SETTINGS),
        version: 0,
        publishedAt: null,
      };
    }
    return {
      ...this.configurationFromRow(row),
      version: Number(row.version),
      publishedAt: row.publishedAt ? new Date(String(row.publishedAt)) : null,
    };
  }

  async createVersion(
    dto: CreateSettingsVersionDto,
    actor: AuditActorContext,
  ): Promise<Record<string, unknown>> {
    return this.transaction(async (session) => {
      const counter = await this.counterModel
        .findByIdAndUpdate(
          SETTINGS_COUNTER_ID,
          { $inc: { nextVersion: 1 } },
          {
            upsert: true,
            new: true,
            setDefaultsOnInsert: true,
            session,
          },
        )
        .lean()
        .exec();
      const version = counter?.nextVersion ?? 1;
      const configuration = mergeSettings(this.patchFromDto(dto));
      const [created] = await this.settingsModel.create(
        [
          {
            version,
            status: SettingsVersionStatus.DRAFT,
            ...configuration,
            createdBy: actor.actorId ?? 'system',
            changeNote: dto.changeNote,
          },
        ],
        { session },
      );
      const view = this.adminView(
        created.toObject({ flattenMaps: true }) as unknown as Record<
          string,
          unknown
        >,
      );
      await this.auditService.record(
        {
          ...actor,
          action: 'settings.version.create',
          category: AuditCategory.ADMINISTRATION,
          resourceType: 'site_settings',
          resourceId: String(version),
          before: null,
          after: view,
        },
        session,
      );
      return view;
    });
  }

  async updateDraft(
    version: number,
    dto: UpdateSettingsVersionDto,
    actor: AuditActorContext,
  ): Promise<Record<string, unknown>> {
    return this.transaction(async (session) => {
      const existing = (await this.settingsModel
        .findOne({ version })
        .session(session)
        .lean({ flattenMaps: true })
        .exec()) as unknown as Record<string, unknown> | null;
      if (!existing) throw new NotFoundException('Versión no encontrada');
      if (existing.status !== SettingsVersionStatus.DRAFT) {
        throw new ConflictException(
          'Solo las versiones en borrador pueden modificarse',
        );
      }

      const configuration = mergeSettings(
        this.patchFromDto(dto),
        this.configurationFromRow(existing),
      );
      const updated = (await this.settingsModel
        .findOneAndUpdate(
          { version, status: SettingsVersionStatus.DRAFT },
          {
            $set: {
              ...configuration,
              ...(dto.changeNote !== undefined
                ? { changeNote: dto.changeNote }
                : {}),
            },
          },
          { new: true, runValidators: true, session },
        )
        .lean({ flattenMaps: true })
        .exec()) as unknown as Record<string, unknown> | null;
      if (!updated) {
        throw new ConflictException(
          'El borrador cambió mientras se actualizaba',
        );
      }
      const view = this.adminView(updated);
      await this.auditService.record(
        {
          ...actor,
          action: 'settings.version.update',
          category: AuditCategory.ADMINISTRATION,
          resourceType: 'site_settings',
          resourceId: String(version),
          before: this.adminView(existing),
          after: view,
        },
        session,
      );
      return view;
    });
  }

  async publish(
    version: number,
    actor: AuditActorContext,
  ): Promise<Record<string, unknown>> {
    return this.transaction(async (session) => {
      const existing = (await this.settingsModel
        .findOne({ version })
        .session(session)
        .lean({ flattenMaps: true })
        .exec()) as unknown as Record<string, unknown> | null;
      if (!existing) throw new NotFoundException('Versión no encontrada');
      if (existing.status === SettingsVersionStatus.ARCHIVED) {
        throw new ConflictException(
          'Una versión archivada no puede publicarse',
        );
      }

      const publishedAt = new Date();
      const updated = (await this.settingsModel
        .findOneAndUpdate(
          { version, status: { $ne: SettingsVersionStatus.ARCHIVED } },
          {
            $set: {
              status: SettingsVersionStatus.PUBLISHED,
              publishedAt,
              publishedBy: actor.actorId ?? 'system',
            },
          },
          { new: true, runValidators: true, session },
        )
        .lean({ flattenMaps: true })
        .exec()) as unknown as Record<string, unknown> | null;
      if (!updated) {
        throw new ConflictException('No se pudo publicar la versión');
      }

      await this.counterModel
        .findByIdAndUpdate(
          SETTINGS_COUNTER_ID,
          {
            $max: { nextVersion: version },
            $set: { publishedVersion: version },
          },
          {
            upsert: true,
            new: true,
            setDefaultsOnInsert: true,
            session,
          },
        )
        .exec();

      const view = this.adminView(updated);
      await this.auditService.record(
        {
          ...actor,
          action: 'settings.version.publish',
          category: AuditCategory.ADMINISTRATION,
          resourceType: 'site_settings',
          resourceId: String(version),
          before: this.adminView(existing),
          after: view,
        },
        session,
      );
      return view;
    });
  }

  async archive(
    version: number,
    actor: AuditActorContext,
  ): Promise<Record<string, unknown>> {
    return this.transaction(async (session) => {
      const counter = await this.counterModel
        .findById(SETTINGS_COUNTER_ID)
        .session(session)
        .lean()
        .exec();
      const existing = (await this.settingsModel
        .findOne({ version })
        .session(session)
        .lean({ flattenMaps: true })
        .exec()) as unknown as Record<string, unknown> | null;
      if (!existing) throw new NotFoundException('Versión no encontrada');
      if (counter?.publishedVersion === version) {
        throw new ConflictException(
          'No se puede archivar la versión pública actual; publica otra primero',
        );
      }
      const updated = (await this.settingsModel
        .findOneAndUpdate(
          { version, status: { $ne: SettingsVersionStatus.ARCHIVED } },
          { $set: { status: SettingsVersionStatus.ARCHIVED } },
          { new: true, session },
        )
        .lean({ flattenMaps: true })
        .exec()) as unknown as Record<string, unknown> | null;
      if (!updated) {
        throw new ConflictException('No se pudo archivar la versión');
      }
      const view = this.adminView(updated);
      await this.auditService.record(
        {
          ...actor,
          action: 'settings.version.archive',
          category: AuditCategory.ADMINISTRATION,
          resourceType: 'site_settings',
          resourceId: String(version),
          before: this.adminView(existing),
          after: view,
        },
        session,
      );
      return view;
    });
  }

  async list(dto: ListSettingsVersionsDto): Promise<PaginatedSettingsVersions> {
    const page = this.boundedInteger(dto.page, 1, 1, Number.MAX_SAFE_INTEGER);
    const limit = this.boundedInteger(dto.limit, 25, 1, 100);
    const filter: FilterQuery<SiteSettings> = dto.status
      ? { status: dto.status }
      : {};
    const [rows, total] = await Promise.all([
      this.settingsModel
        .find(filter)
        .sort({ version: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean({ flattenMaps: true })
        .exec(),
      this.settingsModel.countDocuments(filter).exec(),
    ]);
    return {
      data: rows.map((row) =>
        this.adminView(row as unknown as Record<string, unknown>),
      ),
      meta: { page, limit, total, pages: Math.ceil(total / limit) },
    };
  }

  async getVersion(version: number): Promise<Record<string, unknown>> {
    const row = await this.settingsModel
      .findOne({ version })
      .lean({ flattenMaps: true })
      .exec();
    if (!row) throw new NotFoundException('Versión no encontrada');
    return this.adminView(row as unknown as Record<string, unknown>);
  }

  private patchFromDto(
    dto: CreateSettingsVersionDto | UpdateSettingsVersionDto,
  ): SettingsConfigurationPatch {
    return {
      brand: dto.brand,
      contact: dto.contact,
      social: dto.social,
      theme: dto.theme,
      legal: dto.legal,
      featureFlags: dto.featureFlags,
    } as SettingsConfigurationPatch;
  }

  private configurationFromRow(
    row: Record<string, unknown>,
  ): SettingsConfiguration {
    const rawFlags = row.featureFlags;
    const featureFlags =
      rawFlags instanceof Map
        ? Object.fromEntries(rawFlags.entries())
        : normalizeFeatureFlags(rawFlags);
    return mergeSettings({
      brand: (row.brand ?? {}) as SettingsConfiguration['brand'],
      contact: (row.contact ?? {}) as SettingsConfiguration['contact'],
      social: (row.social ?? {}) as SettingsConfiguration['social'],
      theme: (row.theme ?? {}) as SettingsConfiguration['theme'],
      legal: (row.legal ?? {}) as SettingsConfiguration['legal'],
      featureFlags,
    });
  }

  private adminView(row: Record<string, unknown>): Record<string, unknown> {
    const configuration = this.configurationFromRow(row);
    const result: Record<string, unknown> = {
      id: row._id ? String(row._id) : undefined,
      version: Number(row.version),
      status: row.status,
      ...configuration,
      createdBy: row.createdBy,
      publishedBy: row.publishedBy,
      changeNote: row.changeNote,
      publishedAt: row.publishedAt,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
    return result;
  }

  private async transaction<T>(
    work: (session: ClientSession) => Promise<T>,
  ): Promise<T> {
    if (!this.connection) {
      throw new ServiceUnavailableException(
        'Las mutaciones de configuración requieren transacciones',
      );
    }
    const session = await this.connection.startSession();
    let result: T | undefined;
    try {
      await session.withTransaction(async () => {
        result = undefined;
        result = await work(session);
      });
    } finally {
      await session.endSession();
    }
    if (result === undefined) {
      throw new ServiceUnavailableException(
        'MongoDB no confirmó la mutación de configuración',
      );
    }
    return result;
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
