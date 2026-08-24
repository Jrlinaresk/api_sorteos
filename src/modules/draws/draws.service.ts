import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { createHash } from 'crypto';
import { Connection, Model, Types } from 'mongoose';
import { AdditionalOutcomeDto, VerifyFederalDrawDto } from './dto/verify-federal-draw.dto';
import { VerifyManualDrawDto } from './dto/verify-manual-draw.dto';
import {
  CommitCryptographicDrawDto,
  VerifyCryptographicDrawDto,
} from './dto/cryptographic-draw.dto';
import {
  DrawResult,
  DrawResultDocument,
  DrawResultStatus,
} from './schemas/draw-result.schema';
import {
  CampaignStatus,
  DrawMethod,
  Raffle,
  RaffleDocument,
} from '../riffles/schema/raffle.schema';
import { Quota, QuotaDocument, QuotaStatus } from '../orders/schemas/quota.schema';
import { Order, OrderDocument } from '../orders/schemas/order.schema';
import { NotificationsService } from '../notifications/notifications.service';
import { NotificationType } from '../notifications/schemas/notification.schema';

@Injectable()
export class DrawsService {
  constructor(
    @InjectModel(DrawResult.name)
    private readonly resultModel: Model<DrawResultDocument>,
    @InjectModel(Raffle.name)
    private readonly campaignModel: Model<RaffleDocument>,
    @InjectModel(Quota.name)
    private readonly quotaModel: Model<QuotaDocument>,
    @InjectModel(Order.name)
    private readonly orderModel: Model<OrderDocument>,
    @InjectConnection() private readonly connection: Connection,
    private readonly notifications: NotificationsService,
  ) {}

  async commitCryptographic(
    campaignId: string,
    dto: CommitCryptographicDrawDto,
    actorId: string,
  ) {
    if (!Types.ObjectId.isValid(campaignId)) throw new BadRequestException('Campaña inválida');
    const campaign = await this.campaignModel.findById(campaignId).exec();
    if (!campaign) throw new NotFoundException('Campaña no encontrada');
    if (campaign.drawMethod !== DrawMethod.Cryptographic) {
      throw new ConflictException(`La campaña usa el método ${campaign.drawMethod}`);
    }
    if (![CampaignStatus.Draft, CampaignStatus.Scheduled].includes(campaign.status)) {
      throw new ConflictException('El compromiso debe publicarse antes de abrir ventas');
    }
    if (campaign.drawCommitment && campaign.drawCommitment !== dto.commitment.toLowerCase()) {
      throw new ConflictException('El compromiso criptográfico ya es inmutable');
    }
    campaign.drawCommitment = dto.commitment.toLowerCase();
    campaign.drawCommittedAt = campaign.drawCommittedAt || new Date();
    campaign.drawCommittedBy = campaign.drawCommittedBy || new Types.ObjectId(actorId);
    await campaign.save();
    return {
      campaignId: campaign._id,
      commitment: campaign.drawCommitment,
      committedAt: campaign.drawCommittedAt,
      rule: 'sha256(campaignId:secret)',
    };
  }

  async verifyFederal(campaignId: string, dto: VerifyFederalDrawDto, actorId: string) {
    const campaign = await this.loadDrawableCampaign(campaignId, DrawMethod.FederalLottery);
    const firstDigits = campaign.federalLottery?.firstPrizeDigits ?? 3;
    const secondDigits = campaign.federalLottery?.secondPrizeDigits ?? 3;
    const combination = campaign.federalLottery?.combination ?? 'concatenate';
    const first = dto.firstPrize.padStart(firstDigits, '0').slice(-firstDigits);
    const second =
      secondDigits === 0
        ? ''
        : dto.secondPrize.padStart(secondDigits, '0').slice(-secondDigits);
    const primaryNumber =
      combination === 'sum'
        ? ((Number(first) + Number(second || 0)) % campaign.totalTitles)
            .toString()
            .padStart(campaign.quotaDigits, '0')
        : `${first}${second}`.padStart(campaign.quotaDigits, '0');
    this.assertNumberInCampaign(campaign, primaryNumber);
    const rule =
      combination === 'sum'
        ? `(${first} + ${second}) módulo ${campaign.totalTitles}`
        : `últimos ${firstDigits} dígitos del 1.º premio + últimos ${secondDigits} dígitos del 2.º premio`;
    const evidence = {
      method: DrawMethod.FederalLottery,
      campaignId,
      contest: dto.contest,
      extraction: dto.extraction,
      firstPrize: dto.firstPrize,
      secondPrize: dto.secondPrize,
      sourceUrl: dto.sourceUrl,
      sourcePublishedAt: dto.sourcePublishedAt,
      rule,
      primaryNumber,
      additionalOutcomes: dto.additionalOutcomes || [],
    };
    return this.storeVerifiedResult(
      campaign,
      {
        contest: dto.contest,
        extraction: dto.extraction,
        firstPrize: dto.firstPrize,
        secondPrize: dto.secondPrize,
        sourceUrl: dto.sourceUrl,
        sourcePublishedAt: dto.sourcePublishedAt ? new Date(dto.sourcePublishedAt) : undefined,
        calculationRule: rule,
        rawEvidence: evidence,
        evidenceHash: this.evidenceHash(evidence),
      },
      primaryNumber,
      dto.additionalOutcomes || [],
      actorId,
    );
  }

  async verifyManual(campaignId: string, dto: VerifyManualDrawDto, actorId: string) {
    const campaign = await this.loadDrawableCampaign(campaignId, DrawMethod.ManualExternal);
    const primaryNumber = dto.winningNumber.padStart(campaign.quotaDigits, '0');
    this.assertNumberInCampaign(campaign, primaryNumber);
    const evidence = {
      method: DrawMethod.ManualExternal,
      campaignId,
      primaryNumber,
      evidenceUrl: dto.evidenceUrl,
      explanation: dto.explanation,
      additionalOutcomes: dto.additionalOutcomes || [],
    };
    return this.storeVerifiedResult(
      campaign,
      {
        sourceUrl: dto.evidenceUrl,
        calculationRule: dto.explanation,
        rawEvidence: evidence,
        evidenceHash: this.evidenceHash(evidence),
      },
      primaryNumber,
      dto.additionalOutcomes || [],
      actorId,
    );
  }

  async verifyCryptographic(
    campaignId: string,
    dto: VerifyCryptographicDrawDto,
    actorId: string,
  ) {
    const campaign = await this.loadDrawableCampaign(campaignId, DrawMethod.Cryptographic);
    if (!campaign.drawCommitment) {
      throw new ConflictException('La campaña no publicó un compromiso antes de las ventas');
    }
    const commitment = createHash('sha256')
      .update(`${campaign._id.toString()}:${dto.reveal}`)
      .digest('hex');
    if (commitment !== campaign.drawCommitment) {
      throw new ConflictException('La revelación no corresponde al compromiso publicado');
    }
    const entropyDigest = createHash('sha256')
      .update(`${dto.reveal}:${dto.externalEntropy}:${campaign._id.toString()}`)
      .digest('hex');
    const primaryNumber = (BigInt(`0x${entropyDigest}`) % BigInt(campaign.totalTitles))
      .toString()
      .padStart(campaign.quotaDigits, '0');
    const rule =
      dto.explanation ||
      'sha256(reveal:entropía-externa:campaignId) módulo totalTitles';
    const evidence = {
      method: DrawMethod.Cryptographic,
      campaignId,
      commitment: campaign.drawCommitment,
      revealedSecret: dto.reveal,
      externalEntropy: dto.externalEntropy,
      entropyDigest,
      sourceUrl: dto.sourceUrl,
      sourcePublishedAt: dto.sourcePublishedAt,
      primaryNumber,
      rule,
      additionalOutcomes: dto.additionalOutcomes || [],
    };
    return this.storeVerifiedResult(
      campaign,
      {
        sourceUrl: dto.sourceUrl,
        sourcePublishedAt: dto.sourcePublishedAt ? new Date(dto.sourcePublishedAt) : undefined,
        commitment: campaign.drawCommitment,
        revealedSecret: dto.reveal,
        externalEntropy: dto.externalEntropy,
        entropyDigest,
        calculationRule: rule,
        rawEvidence: evidence,
        evidenceHash: this.evidenceHash(evidence),
      },
      primaryNumber,
      dto.additionalOutcomes || [],
      actorId,
    );
  }

  async publish(campaignId: string, actorId: string) {
    if (!Types.ObjectId.isValid(campaignId))
      throw new BadRequestException('Campaña inválida');

    const session = await this.connection.startSession();
    let published: DrawResultDocument | undefined;
    let campaignSlug: string | undefined;
    let notifyWinner = false;
    try {
      await session.withTransaction(async () => {
        const result = await this.resultModel
          .findOne({ campaign: new Types.ObjectId(campaignId) })
          .session(session)
          .exec();
        if (!result) throw new NotFoundException('Resultado no encontrado');
        if (
          result.status !== DrawResultStatus.Verified &&
          result.status !== DrawResultStatus.Published
        ) {
          throw new ConflictException(
            'El resultado debe estar verificado antes de publicarse',
          );
        }
        if (!result.outcomes.length || !result.outcomes[0].quota) {
          throw new ConflictException(
            'El número ganador no tiene una cuota pagada asociada',
          );
        }
        const campaign = await this.campaignModel
          .findById(campaignId)
          .session(session)
          .exec();
        if (!campaign) throw new NotFoundException('Campaña no encontrada');

        if (result.status === DrawResultStatus.Verified) {
          result.status = DrawResultStatus.Published;
          result.publishedBy = new Types.ObjectId(actorId);
          result.publishedAt = new Date();
          await result.save({ session });
          notifyWinner = true;
        }

        const main = result.outcomes[0];
        campaign.status = CampaignStatus.Drawn;
        campaign.mainWinner = main.user;
        campaign.winners = result.outcomes.flatMap((outcome) =>
          outcome.user ? [outcome.user] : [],
        );
        campaign.winningQuotaNumber = main.winningNumber;
        campaign.resultPublishedAt = result.publishedAt;
        if (campaign.federalLottery) {
          campaign.federalLottery.contest = result.contest;
          campaign.federalLottery.extraction = result.extraction;
          campaign.federalLottery.firstPrize = result.firstPrize;
          campaign.federalLottery.secondPrize = result.secondPrize;
          campaign.federalLottery.sourceUrl = result.sourceUrl;
          campaign.federalLottery.publishedAt = result.sourcePublishedAt;
        }
        await campaign.save({ session });
        campaignSlug = campaign.slug;
        published = result;
      });
    } finally {
      await session.endSession();
    }

    if (!published) {
      throw new ConflictException('No se pudo publicar el resultado');
    }
    const main = published.outcomes[0];
    if (notifyWinner && main.user) {
      await this.notifications
        .create({
          userId: main.user.toString(),
          title: '¡Tu título resultó ganador!',
          body: `El título ${main.winningNumber} ganó ${main.prizeTitle}.`,
          type: NotificationType.Winner,
          data: { campaignId, winningNumber: main.winningNumber },
          actionUrl: `/campanhas/${campaignSlug}/resultado`,
          deliverPush: true,
        })
        .catch(() => undefined);
    }
    return this.publicView(published);
  }

  async findPublicByCampaign(campaignIdOrSlug: string) {
    const campaign = Types.ObjectId.isValid(campaignIdOrSlug)
      ? await this.campaignModel.findById(campaignIdOrSlug).lean()
      : await this.campaignModel.findOne({ slug: campaignIdOrSlug }).lean();
    if (!campaign) throw new NotFoundException('Campaña no encontrada');
    const result = await this.resultModel
      .findOne({ campaign: campaign._id, status: DrawResultStatus.Published })
      .lean();
    if (!result) return null;
    return this.publicView(result as any);
  }

  async listPublic(page = 1, limit = 12) {
    const safePage = Math.max(1, Math.floor(page || 1));
    const safeLimit = Math.min(100, Math.max(1, Math.floor(limit || 12)));
    const filter = { status: DrawResultStatus.Published };
    const [rows, total] = await Promise.all([
      this.resultModel
        .find(filter)
        .populate('campaign', 'name slug prizeTitle media imageUrl drawDate')
        .sort({ publishedAt: -1 })
        .skip((safePage - 1) * safeLimit)
        .limit(safeLimit)
        .lean(),
      this.resultModel.countDocuments(filter),
    ]);
    return {
      data: rows.map((row) => this.publicView(row as any)),
      meta: {
        page: safePage,
        limit: safeLimit,
        total,
        pages: Math.ceil(total / safeLimit),
      },
    };
  }

  async findAdmin(campaignId: string) {
    if (!Types.ObjectId.isValid(campaignId)) throw new BadRequestException('Campaña inválida');
    const result = await this.resultModel
      .findOne({ campaign: new Types.ObjectId(campaignId) })
      .select('+rawEvidence')
      .lean();
    if (!result) throw new NotFoundException('Resultado no encontrado');
    return result;
  }

  private async loadDrawableCampaign(campaignId: string, expectedMethod: DrawMethod) {
    if (!Types.ObjectId.isValid(campaignId)) throw new BadRequestException('Campaña inválida');
    const campaign = await this.campaignModel.findById(campaignId).exec();
    if (!campaign) throw new NotFoundException('Campaña no encontrada');
    if (campaign.drawMethod !== expectedMethod) {
      throw new ConflictException(`La campaña usa el método ${campaign.drawMethod}`);
    }
    if (![CampaignStatus.SoldOut, CampaignStatus.AwaitingDraw].includes(campaign.status)) {
      throw new ConflictException('La campaña todavía no está lista para el sorteo');
    }
    if (campaign.soldCount !== campaign.totalTitles) {
      throw new ConflictException('El resultado solo puede verificarse con el 100% vendido');
    }
    return campaign;
  }

  private async storeVerifiedResult(
    campaign: RaffleDocument,
    evidenceFields: Partial<DrawResult>,
    primaryNumber: string,
    additional: AdditionalOutcomeDto[],
    actorId: string,
  ) {
    const session = await this.connection.startSession();
    let stored: DrawResultDocument | undefined;
    try {
      await session.withTransaction(async () => {
        const existing = await this.resultModel
          .findOne({ campaign: campaign._id })
          .session(session)
          .exec();
        if (existing?.status === DrawResultStatus.Published) {
          throw new ConflictException('Un resultado publicado es inmutable');
        }
        const inputs = [
          {
            position: 1,
            prizeTitle: campaign.prizeTitle,
            winningNumber: primaryNumber,
          },
          ...additional.map((item, index) => ({
            position: index + 2,
            prizeTitle: item.prizeTitle,
            winningNumber: item.winningNumber.padStart(
              campaign.quotaDigits,
              '0',
            ),
          })),
        ];
        const outcomes: Array<{
          position: number;
          prizeTitle: string;
          winningNumber: string;
          quota?: Types.ObjectId;
          order?: Types.ObjectId;
          user?: Types.ObjectId;
          winnerSnapshot?: { name: string; phone: string };
        }> = [];
        for (const input of inputs) {
          this.assertNumberInCampaign(campaign, input.winningNumber);
          const quota = await this.quotaModel
            .findOne({
              campaign: campaign._id,
              number: input.winningNumber,
              status: { $in: [QuotaStatus.Paid, QuotaStatus.Awarded] },
            })
            .session(session)
            .lean();
          const order = quota?.order
            ? ((await this.orderModel
                .findById(quota.order)
                .session(session)
                .lean()) as OrderDocument | null)
            : null;
          outcomes.push({
            ...input,
            quota: quota?._id,
            order: quota?.order,
            user: quota?.user,
            winnerSnapshot: order
              ? { name: order.buyer.name, phone: order.buyer.phone }
              : undefined,
          });
        }
        const payload = {
          ...evidenceFields,
          campaign: campaign._id,
          method: campaign.drawMethod,
          status: DrawResultStatus.Verified,
          outcomes,
          verifiedBy: new Types.ObjectId(actorId),
          verifiedAt: new Date(),
        };
        if (existing) {
          const updated = await this.resultModel.findByIdAndUpdate(
            existing._id,
            payload,
            { new: true, runValidators: true, session },
          );
          if (!updated) {
            throw new ConflictException(
              'El resultado cambió durante la verificación',
            );
          }
          stored = updated;
        } else {
          [stored] = await this.resultModel.create([payload], { session });
        }
        campaign.status = CampaignStatus.AwaitingDraw;
        campaign.drawDate = campaign.drawDate || new Date();
        await campaign.save({ session });
      });
    } finally {
      await session.endSession();
    }
    if (!stored) throw new ConflictException('No se pudo verificar el resultado');
    return stored;
  }

  private assertNumberInCampaign(campaign: Raffle, number: string) {
    if (!/^\d+$/.test(number) || number.length > campaign.quotaDigits) {
      throw new BadRequestException(`Número ganador inválido: ${number}`);
    }
    const numeric = Number(number);
    if (!Number.isSafeInteger(numeric) || numeric < 0 || numeric >= campaign.totalTitles) {
      throw new BadRequestException(`Número fuera del rango de la campaña: ${number}`);
    }
  }

  private evidenceHash(value: Record<string, unknown>) {
    return createHash('sha256').update(this.stableJson(value)).digest('hex');
  }

  private stableJson(value: unknown): string {
    if (Array.isArray(value)) return `[${value.map((item) => this.stableJson(item)).join(',')}]`;
    if (value && typeof value === 'object') {
      const entries = Object.entries(value as Record<string, unknown>)
        .filter(([, item]) => item !== undefined)
        .sort(([a], [b]) => a.localeCompare(b));
      return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${this.stableJson(item)}`).join(',')}}`;
    }
    return JSON.stringify(value);
  }

  private publicView(result: DrawResultDocument | Record<string, any>) {
    const raw = (result as any).toObject ? (result as any).toObject() : { ...(result as any) };
    delete raw.rawEvidence;
    delete raw.verifiedBy;
    delete raw.publishedBy;
    delete raw.__v;
    raw.outcomes = (raw.outcomes || []).map((outcome: any) => ({
      position: outcome.position,
      prizeTitle: outcome.prizeTitle,
      winningNumber: outcome.winningNumber,
      winner: outcome.winnerSnapshot
        ? {
            name: this.maskName(outcome.winnerSnapshot.name),
            phone: this.maskPhone(outcome.winnerSnapshot.phone),
          }
        : null,
    }));
    return raw;
  }

  private maskName(name: string) {
    return name
      .split(/\s+/)
      .map((part, index) => (index === 0 ? part : `${part[0]}.`))
      .join(' ');
  }

  private maskPhone(phone: string) {
    return phone.length < 6 ? phone : `${phone.slice(0, 4)}****${phone.slice(-2)}`;
  }
}
