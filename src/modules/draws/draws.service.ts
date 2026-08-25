import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'crypto';
import { ClientSession, Connection, Model, Types } from 'mongoose';
import { VerifyFederalDrawDto } from './dto/verify-federal-draw.dto';
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
import {
  Quota,
  QuotaDocument,
  QuotaStatus,
} from '../orders/schemas/quota.schema';
import {
  Order,
  OrderDocument,
  OrderStatus,
} from '../orders/schemas/order.schema';
import { NotificationsService } from '../notifications/notifications.service';
import { NotificationType } from '../notifications/schemas/notification.schema';
import { CaixaFederalLotteryService } from './caixa-federal-lottery.service';
import { EntropyBeaconService } from './entropy-beacon.service';
import { MainPrizeAwardsService } from '../main-awards/main-prize-awards.service';
import { PaymentStatus } from '../payments/payment.enums';
import { Payment, PaymentDocument } from '../payments/schemas/payment.schema';
import {
  RefundOperation,
  RefundOperationDocument,
  RefundOperationStatus,
} from '../payments/schemas/refund-operation.schema';

const FINANCIALLY_UNSETTLED_ORDER_STATUSES: readonly OrderStatus[] = [
  OrderStatus.Reserved,
  OrderStatus.PendingPayment,
  OrderStatus.InReview,
  OrderStatus.Disputed,
];

const FINANCIALLY_UNSETTLED_PAYMENT_STATUSES: readonly PaymentStatus[] = [
  PaymentStatus.Created,
  PaymentStatus.Pending,
  PaymentStatus.Active,
  PaymentStatus.UnderReview,
  PaymentStatus.RefundPending,
  PaymentStatus.PartiallyRefunded,
  PaymentStatus.Disputed,
  PaymentStatus.Chargeback,
];

const PENDING_REFUND_OPERATION_STATUSES = [
  RefundOperationStatus.Pending,
  'processing',
];

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
    @InjectModel(Payment.name)
    private readonly paymentModel: Model<PaymentDocument>,
    @InjectModel(RefundOperation.name)
    private readonly refundOperationModel: Model<RefundOperationDocument>,
    @InjectConnection() private readonly connection: Connection,
    private readonly notifications: NotificationsService,
    private readonly caixaFederal: CaixaFederalLotteryService,
    private readonly entropyBeacon: EntropyBeaconService,
    private readonly config: ConfigService,
    @Optional()
    private readonly mainPrizeAwards?: MainPrizeAwardsService,
  ) {}

  async commitCryptographic(
    campaignId: string,
    dto: CommitCryptographicDrawDto,
    actorId: string,
  ) {
    if (!Types.ObjectId.isValid(campaignId))
      throw new BadRequestException('Campaña inválida');
    const campaign = await this.campaignModel.findById(campaignId).exec();
    if (!campaign) throw new NotFoundException('Campaña no encontrada');
    if (campaign.drawMethod !== DrawMethod.Cryptographic) {
      throw new ConflictException(
        `La campaña usa el método ${campaign.drawMethod}`,
      );
    }
    if (
      ![CampaignStatus.Draft, CampaignStatus.Scheduled].includes(
        campaign.status,
      )
    ) {
      throw new ConflictException(
        'El compromiso debe publicarse antes de abrir ventas',
      );
    }
    if (
      campaign.drawCommitment &&
      campaign.drawCommitment !== dto.commitment.toLowerCase()
    ) {
      throw new ConflictException(
        'El compromiso criptográfico ya es inmutable',
      );
    }
    campaign.drawCommitment = dto.commitment.toLowerCase();
    campaign.drawCommittedAt = campaign.drawCommittedAt || new Date();
    campaign.drawCommittedBy =
      campaign.drawCommittedBy || new Types.ObjectId(actorId);
    await campaign.save();
    return {
      campaignId: campaign._id,
      commitment: campaign.drawCommitment,
      committedAt: campaign.drawCommittedAt,
      rule: 'sha256(campaignId:secret)',
    };
  }

  async verifyFederal(
    campaignId: string,
    _dto: VerifyFederalDrawDto,
    actorId: string,
  ) {
    void _dto;
    const campaign = await this.loadDrawableCampaign(
      campaignId,
      DrawMethod.FederalLottery,
    );
    const configuredContest = campaign.federalLottery?.contest;
    if (!configuredContest) {
      throw new ConflictException(
        'La campaña no fijó el concurso Federal antes de abrir ventas',
      );
    }
    const official = await this.caixaFederal.reconcile(configuredContest);
    this.assertFederalTiming(campaign, official.sourceDrawAt);
    const firstDigits = campaign.federalLottery?.firstPrizeDigits ?? 3;
    const secondDigits = campaign.federalLottery?.secondPrizeDigits ?? 3;
    const combination = campaign.federalLottery?.combination ?? 'concatenate';
    const first = official.firstPrize.slice(-firstDigits);
    const second =
      secondDigits === 0 ? '' : official.secondPrize.slice(-secondDigits);
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
      contest: official.contest,
      extraction: official.extraction,
      firstPrize: official.firstPrize,
      secondPrize: official.secondPrize,
      sourceUrl: official.sourceUrl,
      sourceDrawAt: official.sourceDrawAt.toISOString(),
      sourceReads: official.reads,
      normalized: official.normalized,
      rule,
      primaryNumber,
    };
    return this.storeVerifiedResult(
      campaign,
      {
        contest: official.contest,
        extraction: official.extraction,
        firstPrize: official.firstPrize,
        secondPrize: official.secondPrize,
        sourceUrl: official.sourceUrl,
        sourcePublishedAt: official.sourceDrawAt,
        sourceFetchedAt: new Date(official.reads[0].fetchedAt),
        sourceConfirmedAt: new Date(official.reads[1].fetchedAt),
        sourceBodySha256: official.reads[0].bodySha256,
        sourceConfirmationBodySha256: official.reads[1].bodySha256,
        calculationRule: rule,
        rawEvidence: evidence,
        evidenceHash: this.evidenceHash(evidence),
      },
      primaryNumber,
      actorId,
    );
  }

  async verifyManual(
    campaignId: string,
    dto: VerifyManualDrawDto,
    actorId: string,
  ) {
    this.assertMethodEnabled(DrawMethod.ManualExternal);
    const campaign = await this.loadDrawableCampaign(
      campaignId,
      DrawMethod.ManualExternal,
    );
    const primaryNumber = dto.winningNumber.padStart(campaign.quotaDigits, '0');
    this.assertNumberInCampaign(campaign, primaryNumber);
    const evidence = {
      method: DrawMethod.ManualExternal,
      campaignId,
      primaryNumber,
      evidenceUrl: dto.evidenceUrl,
      explanation: dto.explanation,
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
      actorId,
    );
  }

  async verifyCryptographic(
    campaignId: string,
    dto: VerifyCryptographicDrawDto,
    actorId: string,
  ) {
    this.assertMethodEnabled(DrawMethod.Cryptographic);
    const campaign = await this.loadDrawableCampaign(
      campaignId,
      DrawMethod.Cryptographic,
    );
    if (!campaign.drawCommitment) {
      throw new ConflictException(
        'La campaña no publicó un compromiso antes de las ventas',
      );
    }
    const commitment = createHash('sha256')
      .update(`${campaign._id.toString()}:${dto.reveal}`)
      .digest('hex');
    if (commitment !== campaign.drawCommitment) {
      throw new ConflictException(
        'La revelación no corresponde al compromiso publicado',
      );
    }
    const salesClosedAt = this.effectiveSalesClosedAt(campaign);
    if (!campaign.drawDate) {
      throw new ConflictException(
        'La campaña no fijó el instante de la baliza antes de abrir ventas',
      );
    }
    const beacon = await this.entropyBeacon.readAt(
      new Date(campaign.drawDate),
      salesClosedAt,
    );
    const entropyDigest = createHash('sha256')
      .update(`${dto.reveal}:${beacon.outputValue}:${campaign._id.toString()}`)
      .digest('hex');
    const primaryNumber = (
      BigInt(`0x${entropyDigest}`) % BigInt(campaign.totalTitles)
    )
      .toString()
      .padStart(campaign.quotaDigits, '0');
    const rule =
      'sha256(reveal:outputValue de baliza NIST:campaignId) módulo totalTitles';
    const evidence = {
      method: DrawMethod.Cryptographic,
      campaignId,
      commitment: campaign.drawCommitment,
      revealedSecret: dto.reveal,
      externalEntropy: beacon.outputValue,
      entropyDigest,
      sourceUrl: beacon.sourceUrl,
      sourcePublishedAt: beacon.publishedAt.toISOString(),
      beaconPulseUri: beacon.pulseUri,
      beaconSignatureValue: beacon.signatureValue,
      beaconCertificateId: beacon.certificateId,
      beaconBodySha256: beacon.bodySha256,
      beaconFetchedAt: beacon.fetchedAt.toISOString(),
      primaryNumber,
      rule,
    };
    return this.storeVerifiedResult(
      campaign,
      {
        sourceUrl: beacon.sourceUrl,
        sourcePublishedAt: beacon.publishedAt,
        sourceFetchedAt: beacon.fetchedAt,
        sourceBodySha256: beacon.bodySha256,
        commitment: campaign.drawCommitment,
        revealedSecret: dto.reveal,
        externalEntropy: beacon.outputValue,
        entropyDigest,
        calculationRule: rule,
        rawEvidence: evidence,
        evidenceHash: this.evidenceHash(evidence),
      },
      primaryNumber,
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
    let mainAwardId: string | undefined;
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
        if (result.status === DrawResultStatus.Verified) {
          if (!result.verifiedBy) {
            throw new ConflictException(
              'El resultado no conserva la identidad de quien lo verificó',
            );
          }
          if (result.verifiedBy.toString() === actorId) {
            throw new ConflictException(
              'Quien verificó el resultado no puede publicarlo',
            );
          }
        }
        const campaign = await this.campaignModel
          .findById(campaignId)
          .session(session)
          .exec();
        if (!campaign) throw new NotFoundException('Campaña no encontrada');

        if (result.status === DrawResultStatus.Verified) {
          if (
            campaign.status !== CampaignStatus.AwaitingDraw ||
            campaign.soldCount !== campaign.totalTitles ||
            (campaign.reservedCount || 0) !== 0
          ) {
            throw new ConflictException(
              'El resultado no puede publicarse sin el 100% de títulos pagados y sin reservas',
            );
          }
          await this.assertFinanciallySettled(campaign._id, session);
          await this.assertWinningOutcomeEligible(
            campaign._id,
            result.outcomes[0],
            session,
            true,
          );
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
        if (this.mainPrizeAwards) {
          const award = await this.mainPrizeAwards.ensureForPublishedResult(
            result,
            campaign,
            session,
          );
          mainAwardId = award._id.toString();
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
    if (mainAwardId && this.mainPrizeAwards) {
      await this.mainPrizeAwards.tryNotifyAward(mainAwardId);
    } else if (notifyWinner && main.user) {
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
    return this.publicView({
      ...(result as any),
      campaign: {
        id: campaign._id?.toString(),
        name: campaign.name,
        slug: campaign.slug,
        prizeTitle: campaign.prizeTitle,
        media: campaign.media,
        imageUrl: campaign.imageUrl,
        drawDate: campaign.drawDate,
      },
    });
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
    if (!Types.ObjectId.isValid(campaignId))
      throw new BadRequestException('Campaña inválida');
    const result = await this.resultModel
      .findOne({ campaign: new Types.ObjectId(campaignId) })
      .select('+rawEvidence')
      .lean();
    if (!result) throw new NotFoundException('Resultado no encontrado');
    return result;
  }

  private async loadDrawableCampaign(
    campaignId: string,
    expectedMethod: DrawMethod,
  ) {
    if (!Types.ObjectId.isValid(campaignId))
      throw new BadRequestException('Campaña inválida');
    const campaign = await this.campaignModel.findById(campaignId).exec();
    if (!campaign) throw new NotFoundException('Campaña no encontrada');
    if (campaign.drawMethod !== expectedMethod) {
      throw new ConflictException(
        `La campaña usa el método ${campaign.drawMethod}`,
      );
    }
    if (
      ![CampaignStatus.SoldOut, CampaignStatus.AwaitingDraw].includes(
        campaign.status,
      )
    ) {
      throw new ConflictException(
        'La campaña todavía no está lista para el sorteo',
      );
    }
    if (campaign.soldCount !== campaign.totalTitles) {
      throw new ConflictException(
        'El resultado solo puede verificarse con el 100% vendido',
      );
    }
    if ((campaign.reservedCount || 0) !== 0) {
      throw new ConflictException(
        'El resultado no puede verificarse con cuotas aún reservadas',
      );
    }
    await this.assertFinanciallySettled(campaign._id);
    return campaign;
  }

  private async storeVerifiedResult(
    campaign: RaffleDocument,
    evidenceFields: Partial<DrawResult>,
    primaryNumber: string,
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
        if (existing?.status === DrawResultStatus.Verified) {
          throw new ConflictException(
            'El resultado ya fue verificado y no puede sustituirse',
          );
        }
        await this.assertFinanciallySettled(campaign._id, session);
        const inputs = [
          {
            position: 1,
            prizeTitle: campaign.prizeTitle,
            winningNumber: primaryNumber,
          },
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
          const { quota, order } = await this.assertWinningOutcomeEligible(
            campaign._id,
            { winningNumber: input.winningNumber },
            session,
            true,
          );
          outcomes.push({
            ...input,
            quota: quota._id,
            order: order._id,
            user: quota.user,
            winnerSnapshot: {
              name: order.buyer.name,
              phone: order.buyer.phone,
            },
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
          throw new ConflictException(
            'Ya existe un resultado para esta campaña',
          );
        }
        [stored] = await this.resultModel.create([payload], { session });
        campaign.status = CampaignStatus.AwaitingDraw;
        campaign.drawDate = campaign.drawDate || new Date();
        await campaign.save({ session });
      });
    } finally {
      await session.endSession();
    }
    if (!stored)
      throw new ConflictException('No se pudo verificar el resultado');
    return stored;
  }

  private async assertFinanciallySettled(
    campaignId: Types.ObjectId,
    session?: ClientSession,
  ): Promise<void> {
    const orderQuery = this.orderModel
      .findOne({
        campaign: campaignId,
        status: { $in: FINANCIALLY_UNSETTLED_ORDER_STATUSES },
      })
      .select('_id status');
    if (session) orderQuery.session(session);
    const unsettledOrder = await orderQuery.lean().exec();
    if (unsettledOrder) {
      throw new ConflictException(
        'El sorteo está bloqueado por pedidos con liquidación pendiente o en revisión',
      );
    }

    // El outbox que refleja una devolución en el pedido es duradero pero
    // asíncrono. Esta unión impide aprovechar esa breve ventana: cada pedido
    // que aún participa como Paid debe apuntar a un pago íntegramente Paid.
    const inconsistentPaidOrderQuery = this.orderModel.aggregate([
      {
        $match: {
          campaign: campaignId,
          status: OrderStatus.Paid,
        },
      },
      {
        $lookup: {
          from: 'payments',
          localField: 'payment',
          foreignField: '_id',
          as: 'financialPayment',
        },
      },
      {
        $unwind: {
          path: '$financialPayment',
          preserveNullAndEmptyArrays: true,
        },
      },
      {
        $match: {
          $or: [
            { 'financialPayment._id': { $exists: false } },
            { 'financialPayment.status': { $ne: PaymentStatus.Paid } },
            { 'financialPayment.campaign': { $ne: campaignId } },
            { $expr: { $ne: ['$financialPayment.order', '$_id'] } },
            { 'financialPayment.refundedAmountCents': { $gt: 0 } },
            { 'financialPayment.refundReservedAmountCents': { $gt: 0 } },
            {
              'financialPayment.providerRefunds.status': {
                $in: [PaymentStatus.RefundPending, PaymentStatus.Refunded],
              },
            },
            {
              'financialPayment.refunds.status': {
                $in: [
                  PaymentStatus.RefundPending,
                  PaymentStatus.PartiallyRefunded,
                  PaymentStatus.Refunded,
                ],
              },
            },
          ],
        },
      },
      { $limit: 1 },
      { $project: { _id: 1 } },
    ]);
    if (session) inconsistentPaidOrderQuery.session(session);
    if ((await inconsistentPaidOrderQuery.exec()).length) {
      throw new ConflictException(
        'El sorteo está bloqueado porque un pedido participante no conserva un pago íntegramente liquidado',
      );
    }

    const paymentQuery = this.paymentModel
      .findOne({
        campaign: campaignId,
        $or: [
          { status: { $in: FINANCIALLY_UNSETTLED_PAYMENT_STATUSES } },
          { refundReservedAmountCents: { $gt: 0 } },
          { 'providerRefunds.status': PaymentStatus.RefundPending },
          { 'refunds.status': PaymentStatus.RefundPending },
        ],
      })
      .select('_id status');
    if (session) paymentQuery.session(session);
    const unsettledPayment = await paymentQuery.lean().exec();
    if (unsettledPayment) {
      throw new ConflictException(
        'El sorteo está bloqueado por pagos no conciliados, disputados o con devolución pendiente',
      );
    }

    const pendingRefundQuery = this.refundOperationModel.aggregate([
      {
        $match: {
          status: { $in: PENDING_REFUND_OPERATION_STATUSES },
        },
      },
      {
        $lookup: {
          from: 'payments',
          localField: 'payment',
          foreignField: '_id',
          as: 'paymentDocument',
        },
      },
      { $unwind: '$paymentDocument' },
      { $match: { 'paymentDocument.campaign': campaignId } },
      { $limit: 1 },
      { $project: { _id: 1 } },
    ]);
    if (session) pendingRefundQuery.session(session);
    const pendingRefund = await pendingRefundQuery.exec();
    if (pendingRefund.length) {
      throw new ConflictException(
        'El sorteo está bloqueado por una devolución Pix aún en procesamiento',
      );
    }
  }

  private async assertWinningOutcomeEligible(
    campaignId: Types.ObjectId,
    outcome: {
      winningNumber: string;
      quota?: Types.ObjectId;
      order?: Types.ObjectId;
      user?: Types.ObjectId;
    },
    session: ClientSession,
    lockFinancialState: boolean,
  ): Promise<{
    quota: QuotaDocument;
    order: OrderDocument;
    payment: PaymentDocument;
  }> {
    const quotaQuery = outcome.quota
      ? this.quotaModel.findOne({
          _id: outcome.quota,
          campaign: campaignId,
          number: outcome.winningNumber,
          status: { $in: [QuotaStatus.Paid, QuotaStatus.Awarded] },
        })
      : this.quotaModel.findOne({
          campaign: campaignId,
          number: outcome.winningNumber,
          status: { $in: [QuotaStatus.Paid, QuotaStatus.Awarded] },
        });
    const quota = await quotaQuery.session(session).exec();
    if (
      !quota?.order ||
      (outcome.order && quota.order.toString() !== outcome.order.toString()) ||
      (outcome.user && quota.user?.toString() !== outcome.user.toString())
    ) {
      throw new ConflictException(
        'La cuota ganadora ya no pertenece al pedido verificado',
      );
    }

    const order = await this.orderModel
      .findById(quota.order)
      .select('+prizeLifecycleVersion')
      .session(session)
      .exec();
    if (
      !order ||
      order.status !== OrderStatus.Paid ||
      !order.payment ||
      order.campaign.toString() !== campaignId.toString()
    ) {
      throw new ConflictException(
        'El pedido de la cuota ganadora ya no está pagado o elegible',
      );
    }

    const payment = await this.paymentModel
      .findById(order.payment)
      .session(session)
      .exec();
    if (
      !payment ||
      payment.status !== PaymentStatus.Paid ||
      payment.order.toString() !== order._id.toString() ||
      payment.campaign.toString() !== campaignId.toString() ||
      (payment.refundedAmountCents ?? 0) > 0 ||
      (payment.refundReservedAmountCents ?? 0) > 0 ||
      payment.providerRefunds?.some((refund) =>
        [PaymentStatus.RefundPending, PaymentStatus.Refunded].includes(
          refund.status,
        ),
      ) ||
      payment.refunds?.some((refund) =>
        [
          PaymentStatus.RefundPending,
          PaymentStatus.PartiallyRefunded,
          PaymentStatus.Refunded,
        ].includes(refund.status),
      )
    ) {
      throw new ConflictException(
        'El pago de la cuota ganadora ya no está íntegramente pagado o tiene una devolución',
      );
    }

    const pendingRefund = await this.refundOperationModel
      .findOne({
        payment: payment._id,
        status: { $in: PENDING_REFUND_OPERATION_STATUSES },
      })
      .session(session)
      .lean()
      .exec();
    if (pendingRefund) {
      throw new ConflictException(
        'El pago ganador tiene una devolución Pix aún en procesamiento',
      );
    }

    if (lockFinancialState) {
      const quotaLock = await this.quotaModel.updateOne(
        {
          _id: quota._id,
          order: order._id,
          campaign: campaignId,
          number: outcome.winningNumber,
          status: { $in: [QuotaStatus.Paid, QuotaStatus.Awarded] },
        },
        { $inc: { __v: 1 } },
        { session },
      );
      const orderLock = await this.orderModel.updateOne(
        {
          _id: order._id,
          campaign: campaignId,
          payment: payment._id,
          status: OrderStatus.Paid,
        },
        { $inc: { prizeLifecycleVersion: 1, __v: 1 } },
        { session },
      );
      const paymentLock = await this.paymentModel.updateOne(
        {
          _id: payment._id,
          order: order._id,
          campaign: campaignId,
          status: PaymentStatus.Paid,
          refundedAmountCents: { $in: [0, null] },
          refundReservedAmountCents: { $in: [0, null] },
          'providerRefunds.status': {
            $nin: [PaymentStatus.RefundPending, PaymentStatus.Refunded],
          },
          'refunds.status': {
            $nin: [
              PaymentStatus.RefundPending,
              PaymentStatus.PartiallyRefunded,
              PaymentStatus.Refunded,
            ],
          },
        },
        { $inc: { __v: 1 } },
        { session },
      );
      if (
        !this.matchedExactlyOne(quotaLock) ||
        !this.matchedExactlyOne(orderLock) ||
        !this.matchedExactlyOne(paymentLock)
      ) {
        throw new ConflictException(
          'El estado financiero del ganador cambió durante la operación; vuelva a conciliar antes de publicar',
        );
      }
    }

    return { quota, order, payment };
  }

  private matchedExactlyOne(result: {
    matchedCount?: number;
    modifiedCount?: number;
  }): boolean {
    return (result.matchedCount ?? result.modifiedCount ?? 0) === 1;
  }

  private assertFederalTiming(campaign: Raffle, officialDrawAt: Date): void {
    if (!campaign.drawDate) {
      throw new ConflictException(
        'La campaña Federal no conserva la fecha de sorteo declarada',
      );
    }
    const declared = new Date(campaign.drawDate);
    if (
      !Number.isFinite(declared.getTime()) ||
      this.utcDateKey(declared) !== this.utcDateKey(officialDrawAt)
    ) {
      throw new ConflictException(
        'La fecha oficial de CAIXA no coincide con la fecha declarada de la campaña',
      );
    }
    const salesClosedAt = this.effectiveSalesClosedAt(campaign);
    if (this.utcDateKey(officialDrawAt) <= this.utcDateKey(salesClosedAt)) {
      throw new ConflictException(
        'El resultado oficial debe ser de una fecha posterior al cierre efectivo de ventas',
      );
    }
  }

  private effectiveSalesClosedAt(campaign: Raffle): Date {
    const value = campaign.salesClosedAt
      ? new Date(campaign.salesClosedAt)
      : undefined;
    if (!value || !Number.isFinite(value.getTime())) {
      throw new ConflictException(
        'La campaña no conserva una fecha fiable de cierre efectivo de ventas',
      );
    }
    return value;
  }

  private utcDateKey(value: Date): string {
    return value.toISOString().slice(0, 10);
  }

  private assertMethodEnabled(method: DrawMethod): void {
    const production =
      (this.config.get<string>('NODE_ENV') || process.env.NODE_ENV) ===
      'production';
    if (!production) return;
    const setting =
      method === DrawMethod.ManualExternal
        ? 'DRAW_MANUAL_EXTERNAL_ENABLED'
        : 'DRAW_CRYPTOGRAPHIC_ENABLED';
    if (this.config.get<string>(setting) !== 'true') {
      throw new ConflictException(
        `El método ${method} está deshabilitado en producción`,
      );
    }
  }

  private assertNumberInCampaign(campaign: Raffle, number: string) {
    if (!/^\d+$/.test(number) || number.length > campaign.quotaDigits) {
      throw new BadRequestException(`Número ganador inválido: ${number}`);
    }
    const numeric = Number(number);
    if (
      !Number.isSafeInteger(numeric) ||
      numeric < 0 ||
      numeric >= campaign.totalTitles
    ) {
      throw new BadRequestException(
        `Número fuera del rango de la campaña: ${number}`,
      );
    }
  }

  private evidenceHash(value: Record<string, unknown>) {
    return createHash('sha256').update(this.stableJson(value)).digest('hex');
  }

  private stableJson(value: unknown): string {
    if (Array.isArray(value))
      return `[${value.map((item) => this.stableJson(item)).join(',')}]`;
    if (value && typeof value === 'object') {
      const entries = Object.entries(value as Record<string, unknown>)
        .filter(([, item]) => item !== undefined)
        .sort(([a], [b]) => a.localeCompare(b));
      return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${this.stableJson(item)}`).join(',')}}`;
    }
    return JSON.stringify(value);
  }

  private publicView(result: DrawResultDocument | Record<string, any>) {
    const raw = (result as any).toObject
      ? (result as any).toObject()
      : { ...(result as any) };
    delete raw.rawEvidence;
    delete raw.verifiedBy;
    delete raw.publishedBy;
    delete raw.__v;
    raw.evidence = Object.fromEntries(
      [
        'evidenceHash',
        'calculationRule',
        'contest',
        'extraction',
        'firstPrize',
        'secondPrize',
        'sourceUrl',
        'sourcePublishedAt',
        'sourceFetchedAt',
        'sourceConfirmedAt',
        'sourceBodySha256',
        'sourceConfirmationBodySha256',
        'commitment',
        'revealedSecret',
        'externalEntropy',
        'entropyDigest',
      ]
        .map((key) => [key, raw[key]])
        .filter(([, value]) => value !== undefined),
    );
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
    return phone.length < 6
      ? phone
      : `${phone.slice(0, 4)}****${phone.slice(-2)}`;
  }
}
