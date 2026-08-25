import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  Optional,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { ClientSession, Connection, FilterQuery, Model, Types } from 'mongoose';
import { RafflesService } from '../riffles/raffles.service';
import { UsersService } from '../users/users.service';
import { CaptureReferralClickDto } from './dto/capture-referral-click.dto';
import { CreateReferralCodeDto } from './dto/create-referral-code.dto';
import {
  ListReferralClicksQueryDto,
  ListReferralCodesQueryDto,
  ListReferralCommissionsQueryDto,
  ListMyReferralCommissionsQueryDto,
} from './dto/list-referrals-query.dto';
import { UpdateCommissionStatusDto } from './dto/update-commission-status.dto';
import { UpdateReferralCodeDto } from './dto/update-referral-code.dto';
import {
  canTransitionCommission,
  generateReferralCode,
  isReferralCodeUsable,
  normalizeReferralCode,
} from './referral-domain';
import {
  AdminReferralClickView,
  AdminReferralCodeView,
  AdminReferralCommissionView,
  toAdminReferralClick,
  toAdminReferralCode,
  toAdminReferralCommission,
  toUserReferralCommission,
  UserReferralCommissionView,
} from './referral.presenter';
import {
  ReferralClick,
  ReferralClickDocument,
} from './schemas/referral-click.schema';
import {
  ReferralCode,
  ReferralCodeDocument,
} from './schemas/referral-code.schema';
import {
  ReferralCommission,
  ReferralCommissionDocument,
  ReferralCommissionStatus,
} from './schemas/referral-commission.schema';

export interface ReferralPage<T> {
  items: T[];
  page: number;
  limit: number;
  total: number;
}

export interface ReferralClickServerContext {
  ipHash?: string;
  userAgent?: string;
}

@Injectable()
export class ReferralsService {
  constructor(
    @InjectModel(ReferralCode.name)
    private readonly codeModel: Model<ReferralCodeDocument>,
    @InjectModel(ReferralClick.name)
    private readonly clickModel: Model<ReferralClickDocument>,
    @InjectModel(ReferralCommission.name)
    private readonly commissionModel: Model<ReferralCommissionDocument>,
    @Optional()
    @InjectConnection()
    private readonly connection?: Connection,
    @Optional() private readonly users?: UsersService,
    @Optional() private readonly campaigns?: RafflesService,
  ) {}

  async createCode(dto: CreateReferralCodeDto): Promise<ReferralCodeDocument> {
    this.validateValidityWindow(dto.validFrom, dto.validUntil);
    const beneficiaryUser = dto.beneficiaryUserId
      ? this.toObjectId(dto.beneficiaryUserId, 'beneficiario')
      : undefined;
    const commissionRateBps = dto.commissionRateBps ?? 0;
    await this.assertCodeTargets(
      beneficiaryUser,
      commissionRateBps,
      dto.campaignId,
    );

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const code = normalizeReferralCode(dto.code ?? generateReferralCode());
      try {
        return await this.codeModel.create({
          code,
          beneficiaryUser,
          label: dto.label,
          commissionRateBps,
          currency: (dto.currency ?? 'BRL').toUpperCase(),
          campaignId: dto.campaignId,
          validFrom: dto.validFrom ? new Date(dto.validFrom) : undefined,
          validUntil: dto.validUntil ? new Date(dto.validUntil) : undefined,
          maxConversions: dto.maxConversions,
          metadata: dto.metadata ?? {},
        });
      } catch (error) {
        if (!this.isDuplicateKey(error) || dto.code) {
          if (this.isDuplicateKey(error)) {
            throw new ConflictException('El código de referido ya existe');
          }
          throw error;
        }
      }
    }
    throw new ConflictException('No fue posible generar un código único');
  }

  async updateCode(
    id: string,
    dto: UpdateReferralCodeDto,
  ): Promise<ReferralCodeDocument> {
    const _id = this.toObjectId(id, 'código');
    const current = await this.codeModel.findById(_id).exec();
    if (!current)
      throw new NotFoundException('Código de referido no encontrado');

    const validFrom = dto.validFrom ?? current.validFrom?.toISOString();
    const validUntil = dto.validUntil ?? current.validUntil?.toISOString();
    this.validateValidityWindow(validFrom, validUntil);
    const beneficiaryUser = dto.beneficiaryUserId
      ? this.toObjectId(dto.beneficiaryUserId, 'beneficiario')
      : current.beneficiaryUser;
    await this.assertCodeTargets(
      beneficiaryUser,
      dto.commissionRateBps ?? current.commissionRateBps,
      dto.campaignId ?? current.campaignId,
    );

    const update: Record<string, unknown> = { ...dto };
    delete update.beneficiaryUserId;
    if (dto.code) update.code = normalizeReferralCode(dto.code);
    if (dto.currency) update.currency = dto.currency.toUpperCase();
    if (dto.validFrom) update.validFrom = new Date(dto.validFrom);
    if (dto.validUntil) update.validUntil = new Date(dto.validUntil);
    if (dto.beneficiaryUserId) {
      update.beneficiaryUser = beneficiaryUser;
    }

    try {
      const result = await this.codeModel
        .findByIdAndUpdate(_id, { $set: update }, { new: true })
        .exec();
      if (!result)
        throw new NotFoundException('Código de referido no encontrado');
      return result;
    } catch (error) {
      if (this.isDuplicateKey(error)) {
        throw new ConflictException('El código de referido ya existe');
      }
      throw error;
    }
  }

  async resolvePublic(codeValue: string, campaignId?: string) {
    const code = await this.codeModel
      .findOne({ code: normalizeReferralCode(codeValue) })
      .exec();
    if (!code || !isReferralCodeUsable(code, new Date(), campaignId)) {
      throw new NotFoundException('Código de referido no disponible');
    }
    return {
      code: code.code,
      label: code.label,
      campaignId: code.campaignId,
      validUntil: code.validUntil,
    };
  }

  async captureClick(
    dto: CaptureReferralClickDto,
    context: ReferralClickServerContext = {},
  ): Promise<ReferralClickDocument> {
    const normalizedCode = normalizeReferralCode(dto.code);
    const existing = await this.clickModel
      .findOne({ eventId: dto.eventId })
      .exec();
    if (existing) {
      if (existing.code !== normalizedCode) {
        throw new ConflictException('eventId ya fue usado por otro código');
      }
      return existing;
    }

    const code = await this.codeModel.findOne({ code: normalizedCode }).exec();
    if (!code || !isReferralCodeUsable(code, new Date(), dto.campaignId)) {
      throw new NotFoundException('Código de referido no disponible');
    }

    try {
      const click = await this.clickModel.create({
        referralCode: code._id,
        code: code.code,
        eventId: dto.eventId,
        visitorId: dto.visitorId,
        campaignId: code.campaignId ?? dto.campaignId,
        landingPath: dto.landingPath,
        referrer: dto.referrer,
        utmSource: dto.utmSource,
        utmMedium: dto.utmMedium,
        utmCampaign: dto.utmCampaign,
        utmTerm: dto.utmTerm,
        utmContent: dto.utmContent,
        ipHash: context.ipHash,
        userAgent: context.userAgent,
        metadata: {},
      });
      await this.codeModel
        .updateOne({ _id: code._id }, { $inc: { clicksCount: 1 } })
        .exec();
      return click;
    } catch (error) {
      if (this.isDuplicateKey(error)) {
        const duplicate = await this.clickModel
          .findOne({ eventId: dto.eventId })
          .exec();
        if (duplicate) {
          if (duplicate.code !== normalizedCode) {
            throw new ConflictException('eventId ya fue usado por otro código');
          }
          return duplicate;
        }
      }
      throw error;
    }
  }

  async listCodes(
    query: ListReferralCodesQueryDto,
  ): Promise<ReferralPage<AdminReferralCodeView>> {
    const filter: FilterQuery<ReferralCodeDocument> = {};
    if (query.status) filter.status = query.status;
    if (query.campaignId) filter.campaignId = query.campaignId;
    if (query.beneficiaryUserId) {
      filter.beneficiaryUser = this.toObjectId(
        query.beneficiaryUserId,
        'beneficiario',
      );
    }
    return this.paginate<ReferralCode, AdminReferralCodeView>(
      this.codeModel,
      filter,
      query.page,
      query.limit,
      toAdminReferralCode,
    );
  }

  async listClicks(
    query: ListReferralClicksQueryDto,
  ): Promise<ReferralPage<AdminReferralClickView>> {
    const filter: FilterQuery<ReferralClickDocument> = {};
    if (query.code) filter.code = normalizeReferralCode(query.code);
    if (query.utmCampaign) filter.utmCampaign = query.utmCampaign;
    return this.paginate<ReferralClick, AdminReferralClickView>(
      this.clickModel,
      filter,
      query.page,
      query.limit,
      toAdminReferralClick,
    );
  }

  async listCommissions(
    query: ListReferralCommissionsQueryDto,
  ): Promise<ReferralPage<AdminReferralCommissionView>> {
    const filter: FilterQuery<ReferralCommissionDocument> = {};
    if (query.status) filter.status = query.status;
    if (query.orderId) filter.orderId = query.orderId;
    if (query.beneficiaryUserId) {
      filter.beneficiaryUser = this.toObjectId(
        query.beneficiaryUserId,
        'beneficiario',
      );
    }
    return this.paginate<ReferralCommission, AdminReferralCommissionView>(
      this.commissionModel,
      filter,
      query.page,
      query.limit,
      toAdminReferralCommission,
    );
  }

  async listUserCommissions(
    userId: string,
    query: ListMyReferralCommissionsQueryDto,
  ): Promise<ReferralPage<UserReferralCommissionView>> {
    const beneficiaryUser = this.toObjectId(userId, 'beneficiario');
    const filter: FilterQuery<ReferralCommissionDocument> = {
      beneficiaryUser,
    };
    if (query.status) filter.status = query.status;
    if (query.orderId) filter.orderId = query.orderId;
    return this.paginate<ReferralCommission, UserReferralCommissionView>(
      this.commissionModel,
      filter,
      query.page,
      query.limit,
      toUserReferralCommission,
    );
  }

  async userSummary(userId: string) {
    const beneficiaryUser = this.toObjectId(userId, 'beneficiario');
    const [totals, codes] = await Promise.all([
      this.commissionModel
        .aggregate<{
          _id: { status: ReferralCommissionStatus; currency: string };
          amount: number;
          count: number;
        }>([
          { $match: { beneficiaryUser } },
          {
            $group: {
              _id: { status: '$status', currency: '$currency' },
              amount: { $sum: '$commissionAmount' },
              count: { $sum: 1 },
            },
          },
          { $sort: { '_id.currency': 1, '_id.status': 1 } },
        ])
        .exec(),
      this.codeModel
        .find({ beneficiaryUser })
        .select('code status campaignId clicksCount conversionsCount')
        .sort({ createdAt: -1 })
        .lean()
        .exec(),
    ]);
    const campaignById = new Map<
      string,
      { slug?: string; name?: string }
    >();
    if (this.campaigns) {
      await Promise.all(
        [
          ...new Set(
            codes
              .map((code) => code.campaignId)
              .filter((id): id is string => Boolean(id)),
          ),
        ].map(async (campaignId) => {
          const campaign = await this.campaigns!
            .findOne(campaignId)
            .catch(() => undefined);
          if (campaign) {
            campaignById.set(campaignId, {
              slug: campaign.slug,
              name: campaign.name,
            });
          }
        }),
      );
    }
    return {
      totals: totals.map((total) => ({
        status: total._id.status,
        currency: total._id.currency,
        amount: total.amount,
        count: total.count,
      })),
      codes: codes.map((code) => ({
        code: code.code,
        status: code.status,
        campaignId: code.campaignId,
        campaignSlug: code.campaignId
          ? campaignById.get(code.campaignId)?.slug
          : undefined,
        campaignName: code.campaignId
          ? campaignById.get(code.campaignId)?.name
          : undefined,
        clicksCount: code.clicksCount,
        conversionsCount: code.conversionsCount,
      })),
    };
  }

  async updateCommissionStatus(
    id: string,
    dto: UpdateCommissionStatusDto,
  ): Promise<ReferralCommissionDocument> {
    const _id = this.toObjectId(id, 'comisión');
    if (!this.connection) {
      throw new ServiceUnavailableException(
        'La actualización financiera requiere transacciones',
      );
    }
    const session = await this.connection.startSession();
    let result: ReferralCommissionDocument | undefined;
    try {
      await session.withTransaction(async () => {
        result = undefined;
        const commission = await this.commissionModel
          .findById(_id)
          .session(session)
          .exec();
        if (!commission) throw new NotFoundException('Comisión no encontrada');
        if (!canTransitionCommission(commission.status, dto.status)) {
          throw new ConflictException(
            `Transición inválida: ${commission.status} -> ${dto.status}`,
          );
        }

        const releasesConversion =
          this.isReleasedStatus(dto.status) && !commission.conversionReleasedAt;
        if (commission.status === dto.status && !releasesConversion) {
          result = commission;
          return;
        }

        const now = new Date();
        const set: Record<string, unknown> = {
          status: dto.status,
          statusChangedAt: now,
          statusReason: dto.reason,
        };
        if (dto.status === ReferralCommissionStatus.Approved) {
          set.approvedAt = now;
        } else if (dto.status === ReferralCommissionStatus.Paid) {
          set.paidAt = now;
        } else if (dto.status === ReferralCommissionStatus.Rejected) {
          set.rejectedAt = now;
        } else if (dto.status === ReferralCommissionStatus.Reversed) {
          set.reversedAt = now;
        }
        if (releasesConversion) set.conversionReleasedAt = now;

        const filter: Record<string, unknown> = {
          _id,
          status: commission.status,
        };
        if (releasesConversion) {
          filter.conversionReleasedAt = { $exists: false };
        }
        const updated = await this.commissionModel
          .findOneAndUpdate(
            filter,
            { $set: set },
            { new: true, session, runValidators: true },
          )
          .exec();
        if (!updated) {
          throw new ConflictException(
            'La comisión cambió mientras se actualizaba; reintente',
          );
        }
        if (releasesConversion) {
          await this.releaseConversion(updated.referralCode, session);
        }
        result = updated;
      });
    } finally {
      await session.endSession();
    }
    if (!result) {
      throw new ConflictException('No se pudo actualizar la comisión');
    }
    return result;
  }

  private isReleasedStatus(status: ReferralCommissionStatus): boolean {
    return [
      ReferralCommissionStatus.Rejected,
      ReferralCommissionStatus.Reversed,
    ].includes(status);
  }

  private async releaseConversion(
    codeId: Types.ObjectId,
    session: ClientSession,
  ): Promise<void> {
    await this.codeModel
      .updateOne(
        { _id: codeId, conversionsCount: { $gt: 0 } },
        { $inc: { conversionsCount: -1 } },
        { session },
      )
      .exec();
  }

  private async paginate<TResult, TView>(
    model: Model<any>,
    filter: FilterQuery<any>,
    pageValue?: string,
    limitValue?: string,
    presenter?: (item: TResult) => TView,
  ): Promise<ReferralPage<TView>> {
    const page = this.boundedInteger(pageValue, 1, 1, 1_000_000);
    const limit = this.boundedInteger(limitValue, 20, 1, 100);
    const [items, total] = await Promise.all([
      model
        .find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean()
        .exec(),
      model.countDocuments(filter).exec(),
    ]);
    return {
      items: (items as TResult[]).map((item) =>
        presenter ? presenter(item) : (item as unknown as TView),
      ),
      page,
      limit,
      total,
    };
  }

  private validateValidityWindow(validFrom?: string, validUntil?: string) {
    if (
      validFrom &&
      validUntil &&
      new Date(validUntil).getTime() <= new Date(validFrom).getTime()
    ) {
      throw new BadRequestException(
        'validUntil debe ser posterior a validFrom',
      );
    }
  }

  private async assertCodeTargets(
    beneficiaryUser: Types.ObjectId | undefined,
    commissionRateBps: number,
    campaignId?: string,
  ): Promise<void> {
    if (commissionRateBps > 0 && !beneficiaryUser) {
      throw new BadRequestException(
        'Un código con comisión necesita un beneficiario',
      );
    }
    if (beneficiaryUser) {
      if (!this.users) {
        throw new ServiceUnavailableException(
          'No se pudo validar el beneficiario',
        );
      }
      const user = await this.users.findOneOrNull(beneficiaryUser.toString());
      if (!user || !user.isActive) {
        throw new BadRequestException('Beneficiario inexistente o inactivo');
      }
    }
    if (campaignId) {
      if (!Types.ObjectId.isValid(campaignId)) {
        throw new BadRequestException('ID de campaña inválido');
      }
      if (!this.campaigns) {
        throw new ServiceUnavailableException('No se pudo validar la campaña');
      }
      await this.campaigns.findOne(campaignId);
    }
  }

  private toObjectId(value: string, label: string): Types.ObjectId {
    if (!Types.ObjectId.isValid(value)) {
      throw new BadRequestException(`ID de ${label} inválido`);
    }
    return new Types.ObjectId(value);
  }

  private boundedInteger(
    value: string | undefined,
    fallback: number,
    min: number,
    max: number,
  ): number {
    if (value === undefined) return fallback;
    const parsed = Number(value);
    if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) {
      throw new BadRequestException(`Valor numérico fuera de rango: ${value}`);
    }
    return parsed;
  }

  private isDuplicateKey(error: unknown): boolean {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      (error as { code?: number }).code === 11000
    );
  }
}
