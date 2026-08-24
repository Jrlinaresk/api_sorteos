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
}

const PUBLIC_STATUSES = [
  CampaignStatus.Scheduled,
  CampaignStatus.Active,
  CampaignStatus.Open,
  CampaignStatus.SoldOut,
  CampaignStatus.AwaitingDraw,
  CampaignStatus.Drawn,
  CampaignStatus.Closed,
];

@Injectable()
export class RafflesService {
  constructor(
    @InjectModel(Raffle.name) private readonly raffleModel: Model<RaffleDocument>,
    private readonly media: MediaService,
  ) {}

  async create(dto: CreateRaffleDto): Promise<RaffleDocument> {
    const slug = slugifyCampaign(dto.slug || dto.name);
    if (!slug) throw new BadRequestException('El slug de la campaña no es válido');
    const exists = await this.raffleModel.exists({ slug });
    if (exists) throw new ConflictException('Ya existe una campaña con ese slug');

    const totalTitles = dto.totalTitles;
    const quotaDigits =
      dto.quotaDigits ?? Math.max(1, String(Math.max(0, totalTitles - 1)).length);
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
    const reference = `campaign:${campaign._id.toString()}`;
    const mediaIds = this.mediaIds(dto.media);
    try {
      for (const mediaId of mediaIds) await this.media.addReference(mediaId, reference);
      return await campaign.save();
    } catch (error) {
      await Promise.all(
        mediaIds.map((mediaId) => this.media.removeReference(mediaId, reference).catch(() => undefined)),
      );
      throw error;
    }
  }

  async findAll(): Promise<RaffleDocument[]> {
    return this.raffleModel.find().sort({ featured: -1, sortOrder: 1, createdAt: -1 }).exec();
  }

  async findPublic(query: ListCampaignsDto) {
    const page = query.page || 1;
    const limit = query.limit || 12;
    if (query.status && !PUBLIC_STATUSES.includes(query.status)) {
      throw new BadRequestException('Ese estado no está disponible en el catálogo público');
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
      data: rows.map((campaign) => this.toPublicView(campaign as unknown as RaffleDocument, false)),
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
    if (!Types.ObjectId.isValid(id)) throw new BadRequestException('ID de campaña inválido');
    const campaign = await this.raffleModel.findById(id).exec();
    if (!campaign) throw new NotFoundException('Campaña no encontrada');
    return campaign;
  }

  async findPublicBySlug(slug: string) {
    const campaign = await this.raffleModel
      .findOne({ slug: slugifyCampaign(slug), status: { $in: PUBLIC_STATUSES } })
      .lean()
      .exec();
    if (!campaign) throw new NotFoundException('Campaña no encontrada');
    return this.toPublicView(campaign as unknown as RaffleDocument, true);
  }

  async findDocumentBySlug(slug: string): Promise<RaffleDocument> {
    const campaign = await this.raffleModel.findOne({ slug: slugifyCampaign(slug) }).exec();
    if (!campaign) throw new NotFoundException('Campaña no encontrada');
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
    return {
      campaignSlug: campaign.slug,
      version: regulation.version,
      html: regulation.html,
      sha256: regulation.sha256,
      publishedAt: regulation.publishedAt,
      current: campaign.termsVersion === regulation.version,
    };
  }

  async update(id: string, dto: UpdateRaffleDto): Promise<RaffleDocument> {
    const campaign = await this.findOne(id);
    const previousMediaIds = this.mediaIds(campaign.media);
    this.prepareRegulationUpdate(campaign, dto);
    if (dto.totalTitles !== undefined && dto.totalTitles !== campaign.totalTitles) {
      if (campaign.allocationCursor > 0 || campaign.soldCount > 0 || campaign.reservedCount > 0) {
        throw new ConflictException(
          'No se puede cambiar totalTitles después de reservar o vender cuotas',
        );
      }
      campaign.maxParticipants = dto.totalTitles;
    }
    if (dto.slug) {
      const slug = slugifyCampaign(dto.slug);
      const duplicate = await this.raffleModel.exists({ slug, _id: { $ne: campaign._id } });
      if (duplicate) throw new ConflictException('Ya existe una campaña con ese slug');
      dto.slug = slug;
    }
    const nextMediaIds = dto.media === undefined ? previousMediaIds : this.mediaIds(dto.media);
    const added = nextMediaIds.filter((mediaId) => !previousMediaIds.includes(mediaId));
    const removed = previousMediaIds.filter((mediaId) => !nextMediaIds.includes(mediaId));
    const reference = `campaign:${campaign._id.toString()}`;
    try {
      for (const mediaId of added) await this.media.addReference(mediaId, reference);
      Object.assign(campaign, dto);
      this.assertDocumentConfiguration(campaign);
      const saved = await campaign.save();
      await Promise.all(
        removed.map((mediaId) => this.media.removeReference(mediaId, reference).catch(() => undefined)),
      );
      return saved;
    } catch (error) {
      await Promise.all(
        added.map((mediaId) => this.media.removeReference(mediaId, reference).catch(() => undefined)),
      );
      throw error;
    }
  }

  async changeStatus(id: string, status: CampaignStatus): Promise<RaffleDocument> {
    const campaign = await this.findOne(id);
    const allowed = this.allowedTransitions(campaign.status);
    if (!allowed.includes(status)) {
      throw new ConflictException(`Transición inválida: ${campaign.status} → ${status}`);
    }
    if (status === CampaignStatus.Active || status === CampaignStatus.Open) {
      this.assertActivationReady(campaign);
    }
    campaign.status = status;
    if (status === CampaignStatus.Active && !campaign.launchAt) campaign.launchAt = new Date();
    return campaign.save();
  }

  async remove(id: string): Promise<void> {
    const campaign = await this.findOne(id);
    if (campaign.allocationCursor > 0 || campaign.soldCount > 0 || campaign.reservedCount > 0) {
      throw new ConflictException('No se puede eliminar una campaña con actividad; cancélela');
    }
    const mediaIds = this.mediaIds(campaign.media);
    const reference = `campaign:${campaign._id.toString()}`;
    await campaign.deleteOne();
    await Promise.all(
      mediaIds.map((mediaId) => this.media.removeReference(mediaId, reference).catch(() => undefined)),
    );
  }

  async addParticipant(_raffleId?: string, _userId?: string): Promise<never> {
    throw new BadRequestException(
      'La participación directa fue deshabilitada. Use POST /orders/reservations.',
    );
  }

  async removeParticipant(_raffleId?: string, _userId?: string): Promise<never> {
    throw new BadRequestException('Las cuotas se liberan cancelando o expirando el pedido');
  }

  async closeRaffle(id: string): Promise<RaffleDocument> {
    return this.changeStatus(id, CampaignStatus.AwaitingDraw);
  }

  async processLifecycle(at = new Date()) {
    const [activated, soldOut, closedForSales] = await Promise.all([
      this.raffleModel.updateMany(
        {
          status: CampaignStatus.Scheduled,
          launchAt: { $lte: at },
          regulationHtml: { $exists: true, $nin: ['', null] },
          $or: [
            { drawMethod: { $ne: DrawMethod.Cryptographic } },
            { drawCommitment: { $type: 'string' } },
          ],
        },
        { $set: { status: CampaignStatus.Active } },
      ),
      this.raffleModel.updateMany(
        {
          status: { $in: [CampaignStatus.Active, CampaignStatus.Open] },
          $expr: { $gte: ['$soldCount', '$totalTitles'] },
        },
        { $set: { status: CampaignStatus.SoldOut } },
      ),
      this.raffleModel.updateMany(
        {
          status: { $in: [CampaignStatus.Active, CampaignStatus.Open] },
          closesAt: { $lte: at },
        },
        { $set: { status: CampaignStatus.AwaitingDraw } },
      ),
    ]);
    return {
      activated: activated.modifiedCount,
      soldOut: soldOut.modifiedCount,
      closedForSales: closedForSales.modifiedCount,
    };
  }

  calculatePrice(campaign: Raffle, selectedQuantity: number, at = new Date()): CampaignPriceQuote {
    if (!Number.isInteger(selectedQuantity) || selectedQuantity < 1) {
      throw new BadRequestException('La cantidad debe ser un entero positivo');
    }
    if (selectedQuantity > campaign.maxTitlesPerOrder) {
      throw new BadRequestException(
        `La compra no puede superar ${campaign.maxTitlesPerOrder} cuotas`,
      );
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

    const doubleChanceMultiplier = this.isTimedContentActive(campaign.doubleChance, at)
      ? campaign.doubleChance.multiplier || 2
      : 1;
    const allocatedQuantity = selectedQuantity * doubleChanceMultiplier;

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
        ? { quantity: promotion.quantity, totalPrice: promotion.totalPrice, label: promotion.label }
        : undefined,
      doubleChanceMultiplier,
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

  private assertConfiguration(dto: CreateRaffleDto, totalTitles: number, quotaDigits: number) {
    if (dto.status === CampaignStatus.Scheduled && !dto.launchAt) {
      throw new BadRequestException('Una campaña programada necesita launchAt');
    }
    if ([CampaignStatus.Active, CampaignStatus.Open].includes(dto.status as CampaignStatus)) {
      if (!dto.regulationHtml?.trim()) {
        throw new BadRequestException('La campaña necesita un reglamento antes de publicarse');
      }
      if (dto.drawMethod === DrawMethod.Cryptographic) {
        throw new BadRequestException(
          'Cree la campaña criptográfica en borrador, publique el compromiso y luego actívela',
        );
      }
    }
    const launchAt = dto.launchAt ? new Date(dto.launchAt) : undefined;
    const closesAt = dto.closesAt ? new Date(dto.closesAt) : undefined;
    if (launchAt && closesAt && closesAt <= launchAt) {
      throw new BadRequestException('closesAt debe ser posterior a launchAt');
    }
    const maxPerOrder = dto.maxTitlesPerOrder || 20_000;
    for (const quantity of dto.quantitySuggestions || []) {
      if (quantity > maxPerOrder || quantity > totalTitles) {
        throw new BadRequestException('Una cantidad sugerida supera el límite de compra');
      }
    }
    for (const tier of dto.promotionTiers || []) {
      if (tier.quantity > maxPerOrder) {
        throw new BadRequestException('Una promoción supera maxTitlesPerOrder');
      }
      if (tier.totalPrice > dto.ticketPrice * tier.quantity) {
        throw new BadRequestException('Una promoción no puede costar más que el precio normal');
      }
    }
    const drawMethod = dto.drawMethod || DrawMethod.FederalLottery;
    const federal = dto.federalLottery;
    if (
      drawMethod === DrawMethod.FederalLottery &&
      (federal?.combination || 'concatenate') === 'concatenate'
    ) {
      const digits = (federal?.firstPrizeDigits || 3) + (federal?.secondPrizeDigits ?? 3);
      if (digits > quotaDigits || 10 ** digits > totalTitles) {
        throw new BadRequestException(
          'totalTitles/quotaDigits no cubre todos los resultados de la regla federal concatenada',
        );
      }
    }
    for (const timed of [dto.notice, dto.doubleChance]) {
      if (timed?.startsAt && timed.endsAt && new Date(timed.endsAt) <= new Date(timed.startsAt)) {
        throw new BadRequestException('El fin de un contenido temporal debe ser posterior al inicio');
      }
    }
    if (dto.instantGame?.enabled && !dto.instantGame.tiers.length) {
      throw new BadRequestException('El juego instantáneo necesita al menos un tramo de intentos');
    }
  }

  private assertActivationReady(campaign: Raffle) {
    if (!campaign.regulationHtml?.trim()) {
      throw new ConflictException('La campaña necesita un reglamento antes de publicarse');
    }
    if (campaign.drawMethod === DrawMethod.Cryptographic && !campaign.drawCommitment) {
      throw new ConflictException('La campaña necesita publicar el compromiso criptográfico');
    }
    this.ensureCurrentRegulationVersion(campaign);
  }

  private assertDocumentConfiguration(campaign: Raffle) {
    if (
      [CampaignStatus.Active, CampaignStatus.Open].includes(campaign.status) ||
      (campaign.status === CampaignStatus.Scheduled && campaign.launchAt && campaign.launchAt <= new Date())
    ) {
      this.assertActivationReady(campaign);
    }
    if (campaign.launchAt && campaign.closesAt && campaign.closesAt <= campaign.launchAt) {
      throw new BadRequestException('closesAt debe ser posterior a launchAt');
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
      if (digits > campaign.quotaDigits || 10 ** digits > campaign.totalTitles) {
        throw new BadRequestException('La regla federal concatenada excede el espacio de títulos');
      }
    }
    for (const tier of campaign.promotionTiers || []) {
      if (tier.quantity > campaign.maxTitlesPerOrder) {
        throw new BadRequestException('Una promoción supera maxTitlesPerOrder');
      }
      if (tier.totalPrice > campaign.ticketPrice * tier.quantity) {
        throw new BadRequestException('Una promoción no puede costar más que el precio normal');
      }
    }
  }

  private toPublicView(campaign: RaffleDocument, includeDetails: boolean) {
    const raw = (campaign as any).toObject ? (campaign as any).toObject() : { ...(campaign as any) };
    delete raw.participants;
    delete raw.allocationMultiplier;
    delete raw.allocationOffset;
    delete raw.allocationCursor;
    delete raw.winners;
    delete raw.mainWinner;
    delete raw.drawCommittedBy;
    delete raw.__v;
    if (!raw.analytics?.enabled) raw.analytics = { enabled: false };

    const id = raw._id?.toString?.() || raw._id;
    delete raw._id;
    raw.regulationVersions = (raw.regulationHistory || []).map(
      (entry: Record<string, unknown>) => ({
        version: entry.version,
        sha256: entry.sha256,
        publishedAt: entry.publishedAt,
        current: entry.version === raw.termsVersion,
      }),
    );
    delete raw.regulationHistory;

    const denominator = Math.max(1, raw.totalTitles || raw.maxParticipants || 1);
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
      [...(raw.media || [])].sort((a, b) => a.sortOrder - b.sortOrder).find((item) => item.isCover) ||
      raw.media?.[0] ||
      (raw.imageUrl ? { url: raw.imageUrl, type: MediaType.Image, isCover: true, sortOrder: 0 } : null);

    const view: any = {
      ...raw,
      id,
      cover,
      progress,
      availableCount,
      isPurchasable: [CampaignStatus.Active, CampaignStatus.Open].includes(raw.status),
      currentNotice: this.isTimedContentActive(raw.notice, new Date()) ? raw.notice : null,
      doubleChanceActive: this.isTimedContentActive(raw.doubleChance, new Date()),
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
    return [...new Set(
      (media || [])
        .map((item) => item.mediaId?.toString())
        .filter((value): value is string => Boolean(value && Types.ObjectId.isValid(value))),
    )];
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
      dto.termsVersion !== undefined && dto.termsVersion !== campaign.termsVersion;
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

  private allowedTransitions(current: CampaignStatus): CampaignStatus[] {
    const map: Record<CampaignStatus, CampaignStatus[]> = {
      [CampaignStatus.Draft]: [CampaignStatus.Scheduled, CampaignStatus.Active, CampaignStatus.Cancelled],
      [CampaignStatus.Scheduled]: [CampaignStatus.Active, CampaignStatus.Draft, CampaignStatus.Cancelled],
      [CampaignStatus.Active]: [CampaignStatus.SoldOut, CampaignStatus.AwaitingDraw, CampaignStatus.Cancelled],
      [CampaignStatus.Open]: [CampaignStatus.SoldOut, CampaignStatus.AwaitingDraw, CampaignStatus.Cancelled],
      [CampaignStatus.SoldOut]: [CampaignStatus.AwaitingDraw, CampaignStatus.Active, CampaignStatus.Cancelled],
      [CampaignStatus.AwaitingDraw]: [CampaignStatus.Drawn, CampaignStatus.Active, CampaignStatus.Cancelled],
      [CampaignStatus.Drawn]: [CampaignStatus.Closed],
      [CampaignStatus.Closed]: [],
      [CampaignStatus.Cancelled]: [],
    };
    return map[current] || [];
  }
}
