import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { createHash } from 'crypto';
import { FilterQuery, Model, Types } from 'mongoose';
import { CreateRaffleDto } from './dto/create-raffle.dto';
import { ExtendCampaignDto } from './dto/extend-campaign.dto';
import { ListCampaignsDto } from './dto/list-campaigns.dto';
import { UpdateRaffleDto } from './enums/update-raffle.dto';
import {
  CampaignStatus,
  DrawMethod,
  MediaType,
  Raffle,
  RaffleDocument,
  slugifyCampaign,
} from './schema/raffle.schema';
import { MediaService } from '../media/media.service';
import { CaixaFederalLotteryService } from '../draws/caixa-federal-lottery.service';
import { ConfigService } from '@nestjs/config';
import { sanitizeCampaignRichText } from './utils/campaign-rich-text';
import {
  maxSelectedTitles,
  orderMaxAllocatedTitles,
} from '../orders/order-limits';

export interface CampaignPriceQuote {
  selectedQuantity: number;
  bonusQuantity: number;
  allocatedQuantity: number;
  unitPrice: number;
  subtotal: number;
  discount: number;
  total: number;
  currency: string;
  promotion?: { quantity: number; totalPrice: number; label?: string };
  doubleChanceMultiplier: number;
  maxSelectableQuantity: number;
  maxAllocatedTitles: number;
}

const PUBLIC_STATUSES = [
  CampaignStatus.Scheduled,
  CampaignStatus.Active,
  CampaignStatus.Open,
  CampaignStatus.Expired,
  CampaignStatus.SoldOut,
  CampaignStatus.AwaitingDraw,
  CampaignStatus.Drawn,
  CampaignStatus.Closed,
];

const SAFE_CONTENT_FIELDS = [
  'name',
  'shortDescription',
  'description',
  'imageUrl',
  'media',
  'category',
  'size',
  'costLevel',
  'statusLabel',
  'statusText',
  'modules',
  'notice',
  'contacts',
  'seo',
  'analytics',
  'featured',
  'sortOrder',
] as const;

const CONTRACT_FIELDS = [
  'regulationHtml',
  'termsVersion',
  'slug',
  'totalTitles',
  'quotaDigits',
  'launchAt',
  'drawDate',
  'currency',
  'itemPrice',
  'ticketPrice',
  'itemCondition',
  'prizeTitle',
  'cashAlternative',
  'minimumOrderAmount',
  'maxTitlesPerOrder',
  'quantitySuggestions',
  'promotionTiers',
  'drawMethod',
  'federalLottery',
  'instantGame',
  'doubleChance',
  'progressOverride',
] as const;

@Injectable()
export class RafflesService {
  constructor(
    @InjectModel(Raffle.name)
    private readonly raffleModel: Model<RaffleDocument>,
    private readonly media: MediaService,
    private readonly caixaFederal: CaixaFederalLotteryService,
    private readonly config: ConfigService,
  ) {}

  async create(dto: CreateRaffleDto): Promise<RaffleDocument> {
    dto = this.sanitizeRichContentDto(dto);
    if (
      dto.status !== undefined &&
      ![CampaignStatus.Draft, CampaignStatus.Scheduled].includes(dto.status)
    ) {
      throw new BadRequestException(
        'Una campaña solo puede crearse como borrador o programada',
      );
    }
    const slug = slugifyCampaign(dto.slug || dto.name);
    if (!slug)
      throw new BadRequestException('El slug de la campaña no es válido');
    const exists = await this.raffleModel.exists({ slug });
    if (exists)
      throw new ConflictException('Ya existe una campaña con ese slug');

    const totalTitles = dto.totalTitles;
    const quotaDigits =
      dto.quotaDigits ??
      Math.max(1, String(Math.max(0, totalTitles - 1)).length);
    if (10 ** quotaDigits < totalTitles) {
      throw new BadRequestException('quotaDigits no alcanza para totalTitles');
    }
    this.assertConfiguration(dto, totalTitles, quotaDigits);

    const campaign = new this.raffleModel({
      ...dto,
      slug,
      quotaDigits,
      maxParticipants: totalTitles,
      participants: [],
      winners: [],
      allocationCursor: 0,
      soldCount: 0,
      reservedCount: 0,
      currency: (dto.currency || 'BRL').toUpperCase(),
      status: dto.status || CampaignStatus.Draft,
      contractLockedAt:
        dto.status === CampaignStatus.Scheduled ? new Date() : undefined,
      itemCondition: dto.itemCondition || 'new',
      termsVersion: dto.termsVersion || '1',
      regulationHistory: dto.regulationHtml?.trim()
        ? [
            {
              version: dto.termsVersion || '1',
              html: dto.regulationHtml,
              sha256: this.regulationHash(dto.regulationHtml),
              publishedAt: new Date(),
            },
          ]
        : [],
    });
    if (campaign.status === CampaignStatus.Scheduled) {
      await this.assertActivationReady(
        campaign,
        new Date(),
        CampaignStatus.Scheduled,
      );
    }
    const reference = `campaign:${campaign._id.toString()}`;
    const mediaIds = this.mediaIds(dto.media);
    try {
      for (const mediaId of mediaIds)
        await this.media.addReference(mediaId, reference);
      return await campaign.save();
    } catch (error) {
      await Promise.all(
        mediaIds.map((mediaId) =>
          this.media.removeReference(mediaId, reference).catch(() => undefined),
        ),
      );
      throw error;
    }
  }

  async findAll(): Promise<RaffleDocument[]> {
    return this.raffleModel
      .find()
      .sort({ featured: -1, sortOrder: 1, createdAt: -1 })
      .exec();
  }

  async findPublic(query: ListCampaignsDto) {
    const page = query.page || 1;
    const limit = query.limit || 12;
    if (query.status && !PUBLIC_STATUSES.includes(query.status)) {
      throw new BadRequestException(
        'Ese estado no está disponible en el catálogo público',
      );
    }
    const filter: FilterQuery<RaffleDocument> = {
      status: query.status || { $in: PUBLIC_STATUSES },
    };
    if (query.category) filter.category = new Types.ObjectId(query.category);
    if (query.featured !== undefined) filter.featured = query.featured;
    if (query.search?.trim()) filter.$text = { $search: query.search.trim() };

    const [rows, total] = await Promise.all([
      this.raffleModel
        .find(filter)
        .sort({ featured: -1, sortOrder: 1, launchAt: -1, createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean()
        .exec(),
      this.raffleModel.countDocuments(filter),
    ]);

    return {
      data: rows.map((campaign) =>
        this.toPublicView(campaign as unknown as RaffleDocument, false),
      ),
      meta: {
        page,
        limit,
        total,
        pages: Math.max(1, Math.ceil(total / limit)),
        hasNextPage: page * limit < total,
      },
    };
  }

  async findOne(id: string): Promise<RaffleDocument> {
    if (!Types.ObjectId.isValid(id))
      throw new BadRequestException('ID de campaña inválido');
    const campaign = await this.raffleModel.findById(id).exec();
    if (!campaign) throw new NotFoundException('Campaña no encontrada');
    return campaign;
  }

  async findPublicBySlug(slug: string) {
    const campaign = await this.raffleModel
      .findOne({
        slug: slugifyCampaign(slug),
        status: { $in: PUBLIC_STATUSES },
      })
      .lean()
      .exec();
    if (!campaign) throw new NotFoundException('Campaña no encontrada');
    return this.toPublicView(campaign as unknown as RaffleDocument, true);
  }

  async findDocumentBySlug(slug: string): Promise<RaffleDocument> {
    const campaign = await this.raffleModel
      .findOne({ slug: slugifyCampaign(slug) })
      .exec();
    if (!campaign) throw new NotFoundException('Campaña no encontrada');
    return campaign;
  }

  async findPurchasableBySlug(slug: string): Promise<RaffleDocument> {
    const now = new Date();
    const campaign = await this.raffleModel
      .findOne({
        slug: slugifyCampaign(slug),
        status: { $in: [CampaignStatus.Active, CampaignStatus.Open] },
        $and: [
          {
            $or: [
              { launchAt: { $exists: false } },
              { launchAt: null },
              { launchAt: { $lte: now } },
            ],
          },
          {
            $or: [
              { closesAt: { $exists: false } },
              { closesAt: null },
              { closesAt: { $gt: now } },
            ],
          },
          {
            $expr: {
              $lt: [{ $add: ['$soldCount', '$reservedCount'] }, '$totalTitles'],
            },
          },
        ],
      })
      .exec();
    if (!campaign) {
      throw new NotFoundException('Campaña no disponible para compra');
    }
    return campaign;
  }

  async findPublicRegulation(slug: string, version: string) {
    const campaign = await this.raffleModel
      .findOne({
        slug: slugifyCampaign(slug),
        status: { $in: PUBLIC_STATUSES },
        'regulationHistory.version': version,
      })
      .select('slug termsVersion regulationHistory')
      .lean();
    if (!campaign) throw new NotFoundException('Reglamento no encontrado');
    const regulation = campaign.regulationHistory?.find(
      (entry) => entry.version === version,
    );
    if (!regulation) throw new NotFoundException('Reglamento no encontrado');
    const html = sanitizeCampaignRichText(regulation.html);
    return {
      campaignSlug: campaign.slug,
      version: regulation.version,
      html,
      sha256: this.regulationHash(html),
      publishedAt: regulation.publishedAt,
      current: campaign.termsVersion === regulation.version,
    };
  }

  async update(id: string, dto: UpdateRaffleDto): Promise<RaffleDocument> {
    dto = this.sanitizeRichContentDto(dto);
    const campaign = await this.findOne(id);
    const previousMediaIds = this.mediaIds(campaign.media);
    this.assertMutableUpdate(campaign, dto);
    this.prepareRegulationUpdate(campaign, dto);
    if (
      dto.totalTitles !== undefined &&
      dto.totalTitles !== campaign.totalTitles
    ) {
      if (
        campaign.allocationCursor > 0 ||
        campaign.soldCount > 0 ||
        campaign.reservedCount > 0
      ) {
        throw new ConflictException(
          'No se puede cambiar totalTitles después de reservar o vender cuotas',
        );
      }
      campaign.maxParticipants = dto.totalTitles;
    }
    if (dto.slug) {
      const slug = slugifyCampaign(dto.slug);
      const duplicate = await this.raffleModel.exists({
        slug,
        _id: { $ne: campaign._id },
      });
      if (duplicate)
        throw new ConflictException('Ya existe una campaña con ese slug');
      dto.slug = slug;
    }
    const nextMediaIds =
      dto.media === undefined ? previousMediaIds : this.mediaIds(dto.media);
    const added = nextMediaIds.filter(
      (mediaId) => !previousMediaIds.includes(mediaId),
    );
    const removed = previousMediaIds.filter(
      (mediaId) => !nextMediaIds.includes(mediaId),
    );
    const reference = `campaign:${campaign._id.toString()}`;
    try {
      const federalLotteryUpdate = dto.federalLottery;
      const contractLocked = this.isContractLocked(campaign);
      this.applyDefinedFields(campaign, dto, SAFE_CONTENT_FIELDS);
      if (!contractLocked) {
        this.applyDefinedFields(campaign, dto, CONTRACT_FIELDS);
        if (dto.currency !== undefined)
          campaign.currency = dto.currency.toUpperCase();
        if (dto.closesAt !== undefined)
          campaign.closesAt = new Date(dto.closesAt);
      } else if (dto.closesAt !== undefined) {
        campaign.closesAt = new Date(dto.closesAt);
      }
      if (!contractLocked && federalLotteryUpdate) {
        if (campaign.federalLottery) {
          campaign.federalLottery.firstPrizeDigits =
            federalLotteryUpdate.firstPrizeDigits ??
            campaign.federalLottery.firstPrizeDigits;
          campaign.federalLottery.secondPrizeDigits =
            federalLotteryUpdate.secondPrizeDigits ??
            campaign.federalLottery.secondPrizeDigits;
          campaign.federalLottery.combination =
            federalLotteryUpdate.combination ??
            campaign.federalLottery.combination;
          campaign.federalLottery.contest =
            federalLotteryUpdate.contest ?? campaign.federalLottery.contest;
        } else {
          campaign.federalLottery = {
            firstPrizeDigits: federalLotteryUpdate.firstPrizeDigits ?? 3,
            secondPrizeDigits: federalLotteryUpdate.secondPrizeDigits ?? 3,
            combination: federalLotteryUpdate.combination ?? 'concatenate',
            contest: federalLotteryUpdate.contest,
          };
        }
      }
      this.assertDocumentConfiguration(campaign);
      for (const mediaId of added)
        await this.media.addReference(mediaId, reference);
      const saved = await campaign.save();
      await Promise.all(
        removed.map((mediaId) =>
          this.media.removeReference(mediaId, reference).catch(() => undefined),
        ),
      );
      return saved;
    } catch (error) {
      await Promise.all(
        added.map((mediaId) =>
          this.media.removeReference(mediaId, reference).catch(() => undefined),
        ),
      );
      throw error;
    }
  }

  async changeStatus(
    id: string,
    status: CampaignStatus,
  ): Promise<RaffleDocument> {
    const campaign = await this.findOne(id);
    this.sanitizeStoredDraftContent(campaign);
    const leavingDraft =
      campaign.status === CampaignStatus.Draft &&
      status !== CampaignStatus.Draft;
    const allowed = this.allowedTransitions(campaign.status);
    if (!allowed.includes(status)) {
      throw new ConflictException(
        `Transición inválida: ${campaign.status} → ${status}`,
      );
    }
    if (status === CampaignStatus.Cancelled) {
      this.assertCancellationSafe(campaign);
    }
    if (status === CampaignStatus.Expired) {
      this.assertPartiallyExpired(campaign, new Date());
    }
    if (
      [
        CampaignStatus.Scheduled,
        CampaignStatus.Active,
        CampaignStatus.Open,
      ].includes(status)
    ) {
      await this.assertActivationReady(campaign, new Date(), status);
    }
    if (status === CampaignStatus.SoldOut) {
      this.assertFullySold(campaign);
    }
    if (status === CampaignStatus.AwaitingDraw) {
      this.assertFullySold(campaign);
      if ((campaign.reservedCount || 0) !== 0) {
        throw new ConflictException(
          'No se puede cerrar el sorteo con cuotas aún reservadas',
        );
      }
      campaign.salesClosedAt ??= new Date();
    }
    if (leavingDraft) campaign.contractLockedAt ??= new Date();
    campaign.status = status;
    if (status === CampaignStatus.Active && !campaign.launchAt)
      campaign.launchAt = new Date();
    if (leavingDraft) {
      const version = (campaign as unknown as { __v?: number }).__v;
      const filter: FilterQuery<RaffleDocument> = {
        _id: campaign._id,
        status: CampaignStatus.Draft,
        $or: [
          { contractLockedAt: { $exists: false } },
          { contractLockedAt: null },
        ],
      };
      if (version !== undefined) filter.__v = version;
      const locked = await this.raffleModel.findOneAndUpdate(
        filter,
        {
          $set: {
            status,
            contractLockedAt: campaign.contractLockedAt,
            launchAt: campaign.launchAt,
            description: campaign.description,
            regulationHtml: campaign.regulationHtml,
            regulationHistory: campaign.regulationHistory,
          },
          $inc: { contractRevision: 1 },
        },
        { new: true, runValidators: true },
      );
      if (!locked) {
        throw new ConflictException(
          'El contrato cambió durante la publicación; revise y reintente',
        );
      }
      return locked;
    }
    return campaign.save();
  }

  /**
   * Reabre exclusivamente una campaña parcial que el ciclo ya cerró por fecha.
   * La excepción contractual queda ligada al actor y al motivo en el mismo CAS.
   */
  async extendExpiredCampaign(
    id: string,
    dto: ExtendCampaignDto,
    actorId: string,
  ): Promise<RaffleDocument> {
    if (!Types.ObjectId.isValid(actorId)) {
      throw new BadRequestException('Administrador inválido');
    }
    const campaign = await this.findOne(id);
    if (campaign.status !== CampaignStatus.Expired) {
      throw new ConflictException(
        'Solo se puede prorrogar una campaña vencida y cerrada para ventas',
      );
    }
    const now = new Date();
    this.assertPartiallyExpired(campaign, now);
    const previousClosesAt = campaign.closesAt
      ? new Date(campaign.closesAt)
      : undefined;
    if (!previousClosesAt || !Number.isFinite(previousClosesAt.getTime())) {
      throw new ConflictException(
        'La campaña no conserva una fecha de cierre vencida',
      );
    }
    const closesAt = new Date(dto.closesAt);
    if (!Number.isFinite(closesAt.getTime()) || closesAt <= now) {
      throw new BadRequestException('La nueva fecha de cierre debe ser futura');
    }
    if (campaign.drawDate && closesAt >= new Date(campaign.drawDate)) {
      throw new ConflictException(
        'La prórroga debe terminar antes de la fecha declarada del sorteo',
      );
    }
    const reason = dto.reason.trim();
    if (!reason) {
      throw new BadRequestException('El motivo de la prórroga es obligatorio');
    }
    if (
      campaign.drawMethod === DrawMethod.FederalLottery &&
      campaign.drawDate &&
      this.utcDateKey(closesAt) >= this.utcDateKey(new Date(campaign.drawDate))
    ) {
      throw new ConflictException(
        'La prórroga Federal debe terminar en un día anterior al sorteo',
      );
    }

    const candidate = campaign as RaffleDocument;
    candidate.closesAt = closesAt;
    await this.assertActivationReady(candidate, now, CampaignStatus.Active);

    const version = (campaign as unknown as { __v?: number }).__v;
    const filter: FilterQuery<RaffleDocument> = {
      _id: campaign._id,
      status: CampaignStatus.Expired,
      closesAt: previousClosesAt,
      $expr: {
        $lt: [{ $add: ['$soldCount', '$reservedCount'] }, '$totalTitles'],
      },
    };
    if (version !== undefined) filter.__v = version;
    const extendedAt = new Date();
    const extended = await this.raffleModel.findOneAndUpdate(
      filter,
      {
        $set: { status: CampaignStatus.Active, closesAt },
        $unset: { salesClosedAt: 1 },
        $push: {
          lifecycleExtensions: {
            $each: [
              {
                previousClosesAt,
                closesAt,
                reason,
                extendedAt,
                extendedBy: new Types.ObjectId(actorId),
              },
            ],
            $slice: -50,
          },
        },
        $inc: { contractRevision: 1, __v: 1 },
      },
      { new: true, runValidators: true },
    );
    if (!extended) {
      throw new ConflictException(
        'La campaña cambió durante la prórroga; revise y reintente',
      );
    }
    return extended;
  }

  async remove(id: string): Promise<void> {
    const campaign = await this.findOne(id);
    if (
      campaign.allocationCursor > 0 ||
      campaign.soldCount > 0 ||
      campaign.reservedCount > 0
    ) {
      throw new ConflictException(
        'No se puede eliminar una campaña con actividad; cancélela',
      );
    }
    const mediaIds = this.mediaIds(campaign.media);
    const reference = `campaign:${campaign._id.toString()}`;
    await campaign.deleteOne();
    await Promise.all(
      mediaIds.map((mediaId) =>
        this.media.removeReference(mediaId, reference).catch(() => undefined),
      ),
    );
  }

  async addParticipant(_raffleId?: string, _userId?: string): Promise<never> {
    void _raffleId;
    void _userId;
    throw new BadRequestException(
      'La participación directa fue deshabilitada. Use POST /orders/reservations.',
    );
  }

  async removeParticipant(
    _raffleId?: string,
    _userId?: string,
  ): Promise<never> {
    void _raffleId;
    void _userId;
    throw new BadRequestException(
      'Las cuotas se liberan cancelando o expirando el pedido',
    );
  }

  async closeRaffle(id: string): Promise<RaffleDocument> {
    return this.changeStatus(id, CampaignStatus.AwaitingDraw);
  }

  async processLifecycle(at = new Date()) {
    const due = await this.raffleModel
      .find({ status: CampaignStatus.Scheduled, launchAt: { $lte: at } })
      .limit(100)
      .exec();
    let activatedCount = 0;
    let activationBlocked = 0;
    for (const campaign of due) {
      try {
        await this.assertActivationReady(campaign, at, CampaignStatus.Active);
        campaign.status = CampaignStatus.Active;
        campaign.contractLockedAt ??= at;
        await campaign.save();
        activatedCount += 1;
      } catch {
        // Falla cerrado: la tarea vuelve a comprobarlo en el siguiente ciclo.
        activationBlocked += 1;
      }
    }
    const soldOut = await this.raffleModel.updateMany(
      {
        status: { $in: [CampaignStatus.Active, CampaignStatus.Open] },
        $expr: { $eq: ['$soldCount', '$totalTitles'] },
        reservedCount: 0,
      },
      [
        {
          $set: {
            status: CampaignStatus.SoldOut,
            salesClosedAt: { $ifNull: ['$salesClosedAt', at] },
          },
        },
      ],
    );
    const expired = await this.raffleModel.updateMany(
      {
        status: { $in: [CampaignStatus.Active, CampaignStatus.Open] },
        closesAt: { $lte: at },
        $expr: { $lt: ['$soldCount', '$totalTitles'] },
      },
      { $set: { status: CampaignStatus.Expired } },
    );
    const awaitingDraw = await this.raffleModel.updateMany(
      {
        status: CampaignStatus.SoldOut,
        $expr: { $eq: ['$soldCount', '$totalTitles'] },
        reservedCount: 0,
        salesClosedAt: { $exists: true },
      },
      { $set: { status: CampaignStatus.AwaitingDraw } },
    );
    return {
      activated: activatedCount,
      activationBlocked,
      soldOut: soldOut.modifiedCount,
      awaitingDraw: awaitingDraw.modifiedCount,
      closedForSales: expired.modifiedCount,
    };
  }

  calculatePrice(
    campaign: Raffle,
    selectedQuantity: number,
    at = new Date(),
  ): CampaignPriceQuote {
    if (!Number.isInteger(selectedQuantity) || selectedQuantity < 1) {
      throw new BadRequestException('La cantidad debe ser un entero positivo');
    }
    if (selectedQuantity > campaign.maxTitlesPerOrder) {
      throw new BadRequestException(
        `La compra no puede superar ${campaign.maxTitlesPerOrder} cuotas`,
      );
    }

    const doubleChanceMultiplier = this.isTimedContentActive(
      campaign.doubleChance,
      at,
    )
      ? campaign.doubleChance.multiplier || 2
      : 1;
    const maxAllocatedTitles = orderMaxAllocatedTitles();
    const maxSelectableByConfiguration = maxSelectedTitles(
      campaign.maxTitlesPerOrder,
      doubleChanceMultiplier,
    );
    const allocatedQuantity = selectedQuantity * doubleChanceMultiplier;
    if (allocatedQuantity > maxAllocatedTitles) {
      throw new BadRequestException(
        `La compra no puede asignar más de ${maxAllocatedTitles} títulos, incluidos los bonus`,
      );
    }
    const availableCount = Number.isSafeInteger(campaign.totalTitles)
      ? Math.max(
          0,
          campaign.totalTitles -
            (campaign.soldCount || 0) -
            (campaign.reservedCount || 0),
        )
      : maxAllocatedTitles;
    const maxSelectableQuantity = Math.min(
      maxSelectableByConfiguration,
      Math.floor(availableCount / doubleChanceMultiplier),
    );
    if (allocatedQuantity > availableCount) {
      throw new ConflictException('No quedan suficientes cuotas disponibles');
    }

    const unitCents = Math.round(campaign.ticketPrice * 100);
    const subtotalCents = unitCents * selectedQuantity;
    const promotion = (campaign.promotionTiers || []).find(
      (tier) => tier.active && tier.quantity === selectedQuantity,
    );
    const totalCents = promotion
      ? Math.round(promotion.totalPrice * 100)
      : subtotalCents;
    const minimumCents = Math.round((campaign.minimumOrderAmount || 0) * 100);
    if (totalCents < minimumCents) {
      throw new BadRequestException(
        `La compra mínima es ${campaign.currency} ${(minimumCents / 100).toFixed(2)}`,
      );
    }

    return {
      selectedQuantity,
      bonusQuantity: allocatedQuantity - selectedQuantity,
      allocatedQuantity,
      unitPrice: unitCents / 100,
      subtotal: subtotalCents / 100,
      discount: Math.max(0, subtotalCents - totalCents) / 100,
      total: totalCents / 100,
      currency: campaign.currency,
      promotion: promotion
        ? {
            quantity: promotion.quantity,
            totalPrice: promotion.totalPrice,
            label: promotion.label,
          }
        : undefined,
      doubleChanceMultiplier,
      maxSelectableQuantity,
      maxAllocatedTitles,
    };
  }

  private isTimedContentActive(
    value: { enabled?: boolean; startsAt?: Date; endsAt?: Date } | undefined,
    at: Date,
  ): boolean {
    if (!value?.enabled) return false;
    if (value.startsAt && new Date(value.startsAt) > at) return false;
    if (value.endsAt && new Date(value.endsAt) < at) return false;
    return true;
  }

  private assertConfiguration(
    dto: CreateRaffleDto,
    totalTitles: number,
    quotaDigits: number,
  ) {
    if (dto.status === CampaignStatus.Scheduled && !dto.launchAt) {
      throw new BadRequestException('Una campaña programada necesita launchAt');
    }
    const launchAt = dto.launchAt ? new Date(dto.launchAt) : undefined;
    const closesAt = dto.closesAt ? new Date(dto.closesAt) : undefined;
    const drawDate = dto.drawDate ? new Date(dto.drawDate) : undefined;
    if (launchAt && closesAt && closesAt <= launchAt) {
      throw new BadRequestException('closesAt debe ser posterior a launchAt');
    }
    if (drawDate && closesAt && drawDate <= closesAt) {
      throw new BadRequestException('drawDate debe ser posterior a closesAt');
    }
    const maxPerOrder = dto.maxTitlesPerOrder || 20_000;
    for (const quantity of dto.quantitySuggestions || []) {
      if (quantity > maxPerOrder || quantity > totalTitles) {
        throw new BadRequestException(
          'Una cantidad sugerida supera el límite de compra',
        );
      }
    }
    for (const tier of dto.promotionTiers || []) {
      if (tier.quantity > maxPerOrder) {
        throw new BadRequestException('Una promoción supera maxTitlesPerOrder');
      }
      if (tier.totalPrice > dto.ticketPrice * tier.quantity) {
        throw new BadRequestException(
          'Una promoción no puede costar más que el precio normal',
        );
      }
    }
    const drawMethod = dto.drawMethod || DrawMethod.FederalLottery;
    const federal = dto.federalLottery;
    if (
      drawMethod === DrawMethod.FederalLottery &&
      (federal?.combination || 'concatenate') === 'concatenate'
    ) {
      const digits =
        (federal?.firstPrizeDigits || 3) + (federal?.secondPrizeDigits ?? 3);
      if (digits > quotaDigits || 10 ** digits > totalTitles) {
        throw new BadRequestException(
          'totalTitles/quotaDigits no cubre todos los resultados de la regla federal concatenada',
        );
      }
    }
    for (const timed of [dto.notice, dto.doubleChance]) {
      if (
        timed?.startsAt &&
        timed.endsAt &&
        new Date(timed.endsAt) <= new Date(timed.startsAt)
      ) {
        throw new BadRequestException(
          'El fin de un contenido temporal debe ser posterior al inicio',
        );
      }
    }
    if (dto.instantGame?.enabled && !dto.instantGame.tiers.length) {
      throw new BadRequestException(
        'El juego instantáneo necesita al menos un tramo de intentos',
      );
    }
  }

  private async assertActivationReady(
    campaign: Raffle,
    at: Date,
    targetStatus: CampaignStatus,
  ): Promise<void> {
    if (!campaign.regulationHtml?.trim()) {
      throw new ConflictException(
        'La campaña necesita un reglamento antes de publicarse',
      );
    }
    if (
      campaign.drawMethod === DrawMethod.Cryptographic &&
      !campaign.drawCommitment
    ) {
      throw new ConflictException(
        'La campaña necesita publicar el compromiso criptográfico',
      );
    }
    if (
      campaign.drawMethod === DrawMethod.FederalLottery &&
      !/^[1-9]\d{0,9}$/.test(campaign.federalLottery?.contest || '')
    ) {
      throw new ConflictException(
        'La campaña debe fijar el concurso Federal antes de abrir ventas',
      );
    }
    if (
      targetStatus === CampaignStatus.Scheduled &&
      (!campaign.launchAt || new Date(campaign.launchAt) <= at)
    ) {
      throw new ConflictException(
        'Una campaña programada necesita un launchAt futuro',
      );
    }
    if (
      [CampaignStatus.Active, CampaignStatus.Open].includes(targetStatus) &&
      campaign.launchAt &&
      new Date(campaign.launchAt) > at
    ) {
      throw new ConflictException(
        'Use el estado programado mientras launchAt sea futuro',
      );
    }
    if (campaign.closesAt && new Date(campaign.closesAt) <= at) {
      throw new ConflictException(
        'No se puede abrir una campaña cuya fecha de cierre ya pasó',
      );
    }
    if (campaign.drawDate && new Date(campaign.drawDate) <= at) {
      throw new ConflictException(
        'No se puede abrir una campaña cuya fecha de sorteo ya pasó',
      );
    }
    if (
      campaign.drawDate &&
      campaign.closesAt &&
      new Date(campaign.drawDate) <= new Date(campaign.closesAt)
    ) {
      throw new ConflictException(
        'La fecha de sorteo debe ser posterior al cierre de ventas',
      );
    }
    if (campaign.soldCount + campaign.reservedCount >= campaign.totalTitles) {
      throw new ConflictException(
        'No se puede abrir una campaña sin títulos disponibles',
      );
    }
    this.assertDrawMethodEnabled(campaign.drawMethod);
    if (campaign.drawMethod === DrawMethod.Cryptographic) {
      if (!campaign.closesAt || !campaign.drawDate) {
        throw new ConflictException(
          'La campaña criptográfica debe fijar closesAt y drawDate antes de abrir ventas',
        );
      }
    }
    if (campaign.drawMethod === DrawMethod.FederalLottery) {
      if (!campaign.closesAt) {
        throw new ConflictException(
          'La campaña Federal debe fijar closesAt antes de abrir ventas',
        );
      }
      if (!campaign.drawDate) {
        throw new ConflictException(
          'La campaña Federal necesita una drawDate declarada',
        );
      }
      const drawDate = new Date(campaign.drawDate);
      if (!Number.isFinite(drawDate.getTime()) || drawDate <= at) {
        throw new ConflictException(
          'La fecha declarada del sorteo Federal debe ser futura',
        );
      }
      if (
        this.utcDateKey(drawDate) <=
        this.utcDateKey(new Date(campaign.closesAt))
      ) {
        throw new ConflictException(
          'La fecha Federal debe ser un día posterior al cierre de ventas',
        );
      }
      if (campaign.closesAt && new Date(campaign.closesAt) >= drawDate) {
        throw new ConflictException(
          'El sorteo Federal debe ser posterior al cierre de ventas',
        );
      }
      await this.caixaFederal.assertContestUpcoming(
        campaign.federalLottery.contest!,
        drawDate,
        at,
      );
    }
    this.ensureCurrentRegulationVersion(campaign);
  }

  private assertMutableUpdate(campaign: Raffle, dto: UpdateRaffleDto): void {
    if ('status' in (dto as Record<string, unknown>)) {
      throw new BadRequestException(
        'El estado solo puede modificarse mediante el endpoint de transición',
      );
    }
    if (!this.isContractLocked(campaign)) return;

    const attempted = CONTRACT_FIELDS.filter(
      (field) => (dto as Record<string, unknown>)[field] !== undefined,
    );
    if (attempted.length) {
      throw new ConflictException(
        `El contrato de campaña es inmutable; no se puede modificar: ${attempted.join(', ')}`,
      );
    }
    if (dto.closesAt === undefined) return;
    if (!campaign.closesAt) {
      throw new ConflictException(
        'No se puede añadir una fecha de cierre después de congelar el contrato',
      );
    }
    const current = new Date(campaign.closesAt);
    const next = new Date(dto.closesAt);
    const now = new Date();
    if (!Number.isFinite(next.getTime())) {
      throw new BadRequestException('closesAt no es una fecha válida');
    }
    if (next.getTime() === current.getTime()) return;
    if (
      ![
        CampaignStatus.Scheduled,
        CampaignStatus.Active,
        CampaignStatus.Open,
      ].includes(campaign.status) ||
      current <= now ||
      next <= current
    ) {
      throw new ConflictException(
        'Después de publicar solo se permite extender un cierre aún vigente',
      );
    }
    if (campaign.drawDate && next >= new Date(campaign.drawDate)) {
      throw new ConflictException(
        'La extensión debe terminar antes de la fecha declarada del sorteo',
      );
    }
    if (
      campaign.drawMethod === DrawMethod.FederalLottery &&
      campaign.drawDate &&
      this.utcDateKey(next) >= this.utcDateKey(new Date(campaign.drawDate))
    ) {
      throw new ConflictException(
        'La extensión Federal debe terminar en un día anterior al sorteo',
      );
    }
  }

  private assertDocumentConfiguration(campaign: Raffle) {
    if (
      [CampaignStatus.Active, CampaignStatus.Open].includes(campaign.status) ||
      (campaign.status === CampaignStatus.Scheduled &&
        campaign.launchAt &&
        campaign.launchAt <= new Date())
    ) {
      // La comprobación remota CAIXA se hace al cambiar de estado; aquí solo
      // se valida que una edición de contenido no corrompa el documento.
      this.assertActivationConfiguration(campaign);
    }
    if (
      campaign.launchAt &&
      campaign.closesAt &&
      campaign.closesAt <= campaign.launchAt
    ) {
      throw new BadRequestException('closesAt debe ser posterior a launchAt');
    }
    if (
      campaign.drawDate &&
      campaign.closesAt &&
      campaign.drawDate <= campaign.closesAt
    ) {
      throw new BadRequestException('drawDate debe ser posterior a closesAt');
    }
    if (10 ** campaign.quotaDigits < campaign.totalTitles) {
      throw new BadRequestException('quotaDigits no alcanza para totalTitles');
    }
    if (
      campaign.drawMethod === DrawMethod.FederalLottery &&
      campaign.federalLottery?.combination === 'concatenate'
    ) {
      const digits =
        (campaign.federalLottery.firstPrizeDigits || 3) +
        (campaign.federalLottery.secondPrizeDigits ?? 3);
      if (
        digits > campaign.quotaDigits ||
        10 ** digits > campaign.totalTitles
      ) {
        throw new BadRequestException(
          'La regla federal concatenada excede el espacio de títulos',
        );
      }
    }
    for (const tier of campaign.promotionTiers || []) {
      if (tier.quantity > campaign.maxTitlesPerOrder) {
        throw new BadRequestException('Una promoción supera maxTitlesPerOrder');
      }
      if (tier.totalPrice > campaign.ticketPrice * tier.quantity) {
        throw new BadRequestException(
          'Una promoción no puede costar más que el precio normal',
        );
      }
    }
  }

  private assertActivationConfiguration(campaign: Raffle): void {
    if (!campaign.regulationHtml?.trim()) {
      throw new ConflictException(
        'La campaña necesita un reglamento antes de publicarse',
      );
    }
    if (
      campaign.drawMethod === DrawMethod.Cryptographic &&
      !campaign.drawCommitment
    ) {
      throw new ConflictException(
        'La campaña necesita publicar el compromiso criptográfico',
      );
    }
    if (
      campaign.drawMethod === DrawMethod.FederalLottery &&
      !/^[1-9]\d{0,9}$/.test(campaign.federalLottery?.contest || '')
    ) {
      throw new ConflictException(
        'La campaña debe fijar el concurso Federal antes de abrir ventas',
      );
    }
  }

  private assertDrawMethodEnabled(method: DrawMethod): void {
    const production =
      (this.config.get<string>('NODE_ENV') || process.env.NODE_ENV) ===
      'production';
    if (!production) return;
    if (
      method === DrawMethod.ManualExternal &&
      this.config.get<string>('DRAW_MANUAL_EXTERNAL_ENABLED') !== 'true'
    ) {
      throw new ConflictException(
        'El sorteo manual externo está deshabilitado en producción',
      );
    }
    if (
      method === DrawMethod.Cryptographic &&
      this.config.get<string>('DRAW_CRYPTOGRAPHIC_ENABLED') !== 'true'
    ) {
      throw new ConflictException(
        'El sorteo criptográfico está deshabilitado en producción',
      );
    }
  }

  private isContractLocked(campaign: Raffle): boolean {
    return (
      campaign.status !== CampaignStatus.Draft ||
      Boolean(campaign.contractLockedAt) ||
      campaign.allocationCursor > 0 ||
      campaign.soldCount > 0 ||
      campaign.reservedCount > 0
    );
  }

  private applyDefinedFields(
    campaign: RaffleDocument,
    dto: UpdateRaffleDto,
    fields: readonly string[],
  ): void {
    const target = campaign as unknown as Record<string, unknown>;
    const source = dto as unknown as Record<string, unknown>;
    for (const field of fields) {
      if (source[field] !== undefined && field !== 'federalLottery') {
        target[field] = source[field];
      }
    }
  }

  private assertCancellationSafe(campaign: Raffle): void {
    if (campaign.soldCount > 0 || campaign.reservedCount > 0) {
      throw new ConflictException(
        'No se puede cancelar una campaña con ventas o reservas activas; complete primero el flujo de reembolso/cancelación',
      );
    }
  }

  private assertPartiallyExpired(campaign: Raffle, at: Date): void {
    if (!campaign.closesAt || new Date(campaign.closesAt) > at) {
      throw new ConflictException(
        'La campaña todavía no alcanzó su fecha de cierre',
      );
    }
    if (campaign.soldCount >= campaign.totalTitles) {
      throw new ConflictException(
        'Una campaña totalmente vendida debe continuar al sorteo',
      );
    }
  }

  private assertFullySold(campaign: Raffle): void {
    if (campaign.soldCount !== campaign.totalTitles) {
      throw new ConflictException(
        'AwaitingDraw/SoldOut requiere el 100% de títulos pagados',
      );
    }
  }

  private utcDateKey(value: Date): string {
    return value.toISOString().slice(0, 10);
  }

  private toPublicView(campaign: RaffleDocument, includeDetails: boolean) {
    const raw = (campaign as any).toObject
      ? (campaign as any).toObject()
      : { ...(campaign as any) };
    delete raw.participants;
    delete raw.allocationMultiplier;
    delete raw.allocationOffset;
    delete raw.allocationCursor;
    delete raw.winners;
    delete raw.mainWinner;
    delete raw.drawCommittedBy;
    delete raw.lifecycleExtensions;
    delete raw.contractRevision;
    delete raw.__v;
    if (typeof raw.description === 'string') {
      raw.description = sanitizeCampaignRichText(raw.description);
    }
    if (typeof raw.regulationHtml === 'string') {
      raw.regulationHtml = sanitizeCampaignRichText(raw.regulationHtml);
    }
    if (!raw.analytics?.enabled) raw.analytics = { enabled: false };

    const id = raw._id?.toString?.() || raw._id;
    delete raw._id;
    raw.regulationVersions = (raw.regulationHistory || []).map(
      (entry: Record<string, unknown>) => ({
        version: entry.version,
        sha256:
          typeof entry.html === 'string'
            ? this.regulationHash(sanitizeCampaignRichText(entry.html))
            : entry.sha256,
        publishedAt: entry.publishedAt,
        current: entry.version === raw.termsVersion,
      }),
    );
    delete raw.regulationHistory;

    const denominator = Math.max(
      1,
      raw.totalTitles || raw.maxParticipants || 1,
    );
    const calculatedProgress = Math.min(
      100,
      Number((((raw.soldCount || 0) / denominator) * 100).toFixed(2)),
    );
    const progress = raw.progressOverride ?? calculatedProgress;
    const availableCount = Math.max(
      0,
      denominator - (raw.soldCount || 0) - (raw.reservedCount || 0),
    );
    raw.media = (raw.media || []).map((item: Record<string, any>) => ({
      url:
        item.url ||
        (item.mediaId ? `/api/v1/media/${item.mediaId.toString()}` : undefined),
      type: item.type,
      alt: item.alt,
      sortOrder: item.sortOrder,
      isCover: item.isCover,
    }));
    const cover =
      [...(raw.media || [])]
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .find((item) => item.isCover) ||
      raw.media?.[0] ||
      (raw.imageUrl
        ? {
            url: raw.imageUrl,
            type: MediaType.Image,
            isCover: true,
            sortOrder: 0,
          }
        : null);

    const now = new Date();
    const doubleChanceMultiplier = this.isTimedContentActive(
      raw.doubleChance,
      now,
    )
      ? raw.doubleChance.multiplier || 2
      : 1;
    const configuredMaxTitlesPerOrder = Number(raw.maxTitlesPerOrder || 0);
    const effectiveMaxTitlesPerOrder = Math.min(
      maxSelectedTitles(configuredMaxTitlesPerOrder, doubleChanceMultiplier),
      Math.floor(availableCount / doubleChanceMultiplier),
    );
    raw.maxTitlesPerOrder = effectiveMaxTitlesPerOrder;
    raw.quantitySuggestions = (raw.quantitySuggestions || []).filter(
      (quantity: number) => quantity <= effectiveMaxTitlesPerOrder,
    );
    raw.promotionTiers = (raw.promotionTiers || []).filter(
      (tier: { quantity?: number }) =>
        Number(tier.quantity || 0) <= effectiveMaxTitlesPerOrder,
    );
    const withinLaunchWindow =
      !raw.launchAt || new Date(raw.launchAt).getTime() <= now.getTime();
    const withinClosingWindow =
      !raw.closesAt || new Date(raw.closesAt).getTime() > now.getTime();
    const view: any = {
      ...raw,
      id,
      cover,
      progress,
      availableCount,
      isPurchasable:
        [CampaignStatus.Active, CampaignStatus.Open].includes(raw.status) &&
        withinLaunchWindow &&
        withinClosingWindow &&
        availableCount > 0 &&
        effectiveMaxTitlesPerOrder > 0,
      currentNotice: this.isTimedContentActive(raw.notice, now)
        ? raw.notice
        : null,
      doubleChanceActive: doubleChanceMultiplier > 1,
      purchaseLimits: {
        maxSelectedTitles: effectiveMaxTitlesPerOrder,
        maxAllocatedTitles: orderMaxAllocatedTitles(),
        allocationMultiplier: doubleChanceMultiplier,
      },
    };
    if (!includeDetails) {
      delete view.regulationHtml;
      delete view.description;
      delete view.federalLottery;
      delete view.promotionTiers;
      delete view.quantitySuggestions;
    }
    return view;
  }

  private mediaIds(media: Array<{ mediaId?: unknown }> | undefined): string[] {
    return [
      ...new Set(
        (media || [])
          .map((item) => item.mediaId?.toString())
          .filter((value): value is string =>
            Boolean(value && Types.ObjectId.isValid(value)),
          ),
      ),
    ];
  }

  private prepareRegulationUpdate(
    campaign: RaffleDocument,
    dto: UpdateRaffleDto,
  ): void {
    const nextHtml = dto.regulationHtml ?? campaign.regulationHtml;
    const nextVersion = dto.termsVersion ?? campaign.termsVersion;
    const htmlChanged =
      dto.regulationHtml !== undefined &&
      dto.regulationHtml !== campaign.regulationHtml;
    const versionChanged =
      dto.termsVersion !== undefined &&
      dto.termsVersion !== campaign.termsVersion;
    if (!htmlChanged && !versionChanged) return;
    if (!nextHtml?.trim()) {
      if (campaign.allocationCursor > 0 || campaign.soldCount > 0) {
        throw new ConflictException(
          'No se puede retirar el reglamento después de iniciar ventas',
        );
      }
      return;
    }

    const hasActivity =
      campaign.allocationCursor > 0 ||
      campaign.soldCount > 0 ||
      campaign.reservedCount > 0;
    if (hasActivity && htmlChanged && !versionChanged) {
      throw new ConflictException(
        'Cambiar el reglamento después de iniciar ventas requiere una nueva termsVersion',
      );
    }

    campaign.regulationHistory ??= [];
    const hash = this.regulationHash(nextHtml);
    const existing = campaign.regulationHistory.find(
      (entry) => entry.version === nextVersion,
    );
    if (existing) {
      if (versionChanged || (hasActivity && existing.sha256 !== hash)) {
        throw new ConflictException(
          'Una versión de reglamento ya publicada no puede reutilizarse',
        );
      }
      existing.html = nextHtml;
      existing.sha256 = hash;
      existing.publishedAt = new Date();
      return;
    }
    campaign.regulationHistory.push({
      version: nextVersion,
      html: nextHtml,
      sha256: hash,
      publishedAt: new Date(),
    });
  }

  private ensureCurrentRegulationVersion(campaign: Raffle): void {
    if (!campaign.regulationHtml?.trim()) return;
    campaign.regulationHistory ??= [];
    const hash = this.regulationHash(campaign.regulationHtml);
    const existing = campaign.regulationHistory.find(
      (entry) => entry.version === campaign.termsVersion,
    );
    if (existing) {
      if (existing.sha256 !== hash) {
        throw new ConflictException(
          'La versión vigente no coincide con el reglamento conservado',
        );
      }
      return;
    }
    campaign.regulationHistory.push({
      version: campaign.termsVersion,
      html: campaign.regulationHtml,
      sha256: hash,
      publishedAt: new Date(),
    });
  }

  private regulationHash(html: string): string {
    return createHash('sha256').update(html, 'utf8').digest('hex');
  }

  private sanitizeRichContentDto<
    T extends { description?: string; regulationHtml?: string },
  >(dto: T): T {
    return {
      ...dto,
      ...(dto.description !== undefined
        ? { description: sanitizeCampaignRichText(dto.description) }
        : {}),
      ...(dto.regulationHtml !== undefined
        ? { regulationHtml: sanitizeCampaignRichText(dto.regulationHtml) }
        : {}),
    };
  }

  /** Canonicaliza borradores heredados antes de hacer público su contrato. */
  private sanitizeStoredDraftContent(campaign: RaffleDocument): void {
    if (campaign.status !== CampaignStatus.Draft) return;
    if (campaign.description !== undefined) {
      campaign.description = sanitizeCampaignRichText(campaign.description);
    }
    if (campaign.regulationHtml !== undefined) {
      campaign.regulationHtml = sanitizeCampaignRichText(
        campaign.regulationHtml,
      );
    }
    campaign.regulationHistory = (campaign.regulationHistory ?? []).map(
      (entry) => {
        const html = sanitizeCampaignRichText(entry.html);
        return {
          version: entry.version,
          html,
          sha256: this.regulationHash(html),
          publishedAt: entry.publishedAt,
        };
      },
    );
  }

  private allowedTransitions(current: CampaignStatus): CampaignStatus[] {
    const map: Record<CampaignStatus, CampaignStatus[]> = {
      [CampaignStatus.Draft]: [
        CampaignStatus.Scheduled,
        CampaignStatus.Active,
        CampaignStatus.Cancelled,
      ],
      [CampaignStatus.Scheduled]: [
        CampaignStatus.Active,
        CampaignStatus.Cancelled,
      ],
      [CampaignStatus.Active]: [
        CampaignStatus.Expired,
        CampaignStatus.SoldOut,
        CampaignStatus.AwaitingDraw,
        CampaignStatus.Cancelled,
      ],
      [CampaignStatus.Open]: [
        CampaignStatus.Expired,
        CampaignStatus.SoldOut,
        CampaignStatus.AwaitingDraw,
        CampaignStatus.Cancelled,
      ],
      [CampaignStatus.SoldOut]: [
        CampaignStatus.AwaitingDraw,
        CampaignStatus.Active,
        CampaignStatus.Cancelled,
      ],
      [CampaignStatus.AwaitingDraw]: [CampaignStatus.Drawn],
      [CampaignStatus.Expired]: [CampaignStatus.Cancelled],
      [CampaignStatus.Drawn]: [CampaignStatus.Closed],
      [CampaignStatus.Closed]: [],
      [CampaignStatus.Cancelled]: [],
    };
    return map[current] || [];
  }
}
