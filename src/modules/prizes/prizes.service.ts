import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'crypto';
import { Connection, ClientSession, Model, Types } from 'mongoose';
import { CreateInstantPrizeDto } from './dto/create-instant-prize.dto';
import { UpdateInstantPrizeDto } from './dto/update-instant-prize.dto';
import {
  InstantPrize,
  InstantPrizeDocument,
  InstantPrizeStatus,
  PrizeMechanic,
} from './schemas/instant-prize.schema';
import {
  PrizeAttempt,
  PrizeAttemptDocument,
  PrizeAttemptOutcome,
  PrizeAttemptStatus,
  PrizePlanSnapshot,
  PrizePlanSnapshotEntry,
} from './schemas/prize-attempt.schema';
import {
  PrizeAward,
  PrizeAwardDocument,
  PrizeAwardStatus,
} from './schemas/prize-award.schema';
import {
  CampaignStatus,
  Raffle,
  RaffleDocument,
} from '../riffles/schema/raffle.schema';
import {
  Order,
  OrderDocument,
  OrderStatus,
} from '../orders/schemas/order.schema';
import {
  Quota,
  QuotaDocument,
  QuotaStatus,
} from '../orders/schemas/quota.schema';
import { OrdersService } from '../orders/orders.service';
import { MediaService } from '../media/media.service';

@Injectable()
export class PrizesService {
  constructor(
    @InjectModel(InstantPrize.name)
    private readonly prizeModel: Model<InstantPrizeDocument>,
    @InjectModel(PrizeAttempt.name)
    private readonly attemptModel: Model<PrizeAttemptDocument>,
    @InjectModel(PrizeAward.name)
    private readonly awardModel: Model<PrizeAwardDocument>,
    @InjectModel(Raffle.name)
    private readonly campaignModel: Model<RaffleDocument>,
    @InjectModel(Order.name)
    private readonly orderModel: Model<OrderDocument>,
    @InjectModel(Quota.name)
    private readonly quotaModel: Model<QuotaDocument>,
    @InjectConnection() private readonly connection: Connection,
    private readonly orders: OrdersService,
    private readonly media: MediaService,
  ) {}

  async create(dto: CreateInstantPrizeDto) {
    const campaign = await this.campaignModel.findById(dto.campaignId).exec();
    if (!campaign) throw new NotFoundException('Campaña no encontrada');
    await this.assertPrizePlanEditable(campaign);
    const payload: Record<string, unknown> = { ...dto, campaign: campaign._id };
    delete payload.campaignId;
    if (dto.mechanic === PrizeMechanic.WinningTitle) {
      if (!dto.quotaNumber) {
        throw new BadRequestException(
          'Los títulos premiados necesitan quotaNumber',
        );
      }
      payload.quotaNumber = this.normalizeWinningTitle(
        dto.quotaNumber,
        campaign,
      );
      payload.stock = 1;
    } else if (dto.quotaNumber) {
      throw new BadRequestException(
        'quotaNumber solo corresponde a winning_title',
      );
    }
    const prize = new this.prizeModel(payload);
    const reference = `prize:${prize._id.toString()}`;
    if (dto.mediaId) await this.media.addReference(dto.mediaId, reference);
    try {
      return await prize.save();
    } catch (error) {
      if (dto.mediaId) {
        await this.media
          .removeReference(dto.mediaId, reference)
          .catch(() => undefined);
      }
      throw error;
    }
  }

  async update(id: string, dto: UpdateInstantPrizeDto) {
    if (!Types.ObjectId.isValid(id))
      throw new BadRequestException('Premio inválido');
    const existing = await this.prizeModel.findById(id).exec();
    if (!existing) throw new NotFoundException('Premio no encontrado');
    const sourceCampaign = await this.campaignModel
      .findById(existing.campaign)
      .exec();
    if (!sourceCampaign) throw new NotFoundException('Campaña no encontrada');
    await this.assertPrizePlanEditable(sourceCampaign);

    let targetCampaign = sourceCampaign;
    if (dto.campaignId && dto.campaignId !== existing.campaign.toString()) {
      const destinationCampaign = await this.campaignModel
        .findById(dto.campaignId)
        .exec();
      if (!destinationCampaign)
        throw new NotFoundException('Campaña de destino no encontrada');
      await this.assertPrizePlanEditable(destinationCampaign);
      targetCampaign = destinationCampaign;
    }

    const payload: Record<string, unknown> = { ...dto };
    if (dto.campaignId) payload.campaign = new Types.ObjectId(dto.campaignId);
    delete payload.campaignId;
    const mechanic = dto.mechanic ?? existing.mechanic;
    const quotaNumber =
      dto.quotaNumber === undefined ? existing.quotaNumber : dto.quotaNumber;
    if (mechanic === PrizeMechanic.WinningTitle) {
      if (!quotaNumber) {
        throw new BadRequestException(
          'Los títulos premiados necesitan quotaNumber',
        );
      }
      payload.quotaNumber = this.normalizeWinningTitle(
        quotaNumber,
        targetCampaign,
      );
      payload.stock = 1;
    } else {
      if (dto.quotaNumber) {
        throw new BadRequestException(
          'quotaNumber solo corresponde a winning_title',
        );
      }
      payload.quotaNumber = undefined;
    }
    const oldMediaId = existing.mediaId?.toString();
    const newMediaId = dto.mediaId === undefined ? oldMediaId : dto.mediaId;
    const reference = `prize:${existing._id.toString()}`;
    if (newMediaId && newMediaId !== oldMediaId) {
      await this.media.addReference(newMediaId, reference);
    }
    try {
      Object.assign(existing, payload);
      const saved = await existing.save();
      if (oldMediaId && oldMediaId !== newMediaId) {
        await this.media
          .removeReference(oldMediaId, reference)
          .catch(() => undefined);
      }
      return saved;
    } catch (error) {
      if (newMediaId && newMediaId !== oldMediaId) {
        await this.media
          .removeReference(newMediaId, reference)
          .catch(() => undefined);
      }
      throw error;
    }
  }

  async remove(id: string) {
    if (!Types.ObjectId.isValid(id))
      throw new BadRequestException('Premio inválido');
    const prize = await this.prizeModel.findById(id).exec();
    if (!prize) throw new NotFoundException('Premio no encontrado');
    const campaign = await this.campaignModel.findById(prize.campaign).exec();
    if (!campaign) throw new NotFoundException('Campaña no encontrada');
    await this.assertPrizePlanEditable(campaign);
    const mediaId = prize.mediaId?.toString();
    const reference = `prize:${prize._id.toString()}`;
    await prize.deleteOne();
    if (mediaId)
      await this.media
        .removeReference(mediaId, reference)
        .catch(() => undefined);
    return { deleted: true };
  }

  async listPublic(campaignId: string) {
    if (!Types.ObjectId.isValid(campaignId))
      throw new BadRequestException('Campaña inválida');
    const campaign = new Types.ObjectId(campaignId);
    const visibleCampaign = await this.campaignModel
      .findOne({
        _id: campaign,
        status: {
          $in: [
            CampaignStatus.Scheduled,
            CampaignStatus.Active,
            CampaignStatus.Open,
            CampaignStatus.SoldOut,
            CampaignStatus.AwaitingDraw,
            CampaignStatus.Drawn,
            CampaignStatus.Closed,
          ],
        },
        'modules.showInstantPrizes': true,
      })
      .select('_id')
      .lean();
    if (!visibleCampaign) {
      throw new NotFoundException(
        'Este módulo no está habilitado en la campaña',
      );
    }
    const [prizes, awards] = await Promise.all([
      this.prizeModel
        .find({ campaign, status: { $ne: InstantPrizeStatus.Cancelled } })
        .sort({ sortOrder: 1, createdAt: 1 })
        .lean(),
      this.awardModel
        .find({ campaign, status: { $ne: PrizeAwardStatus.Reversed } })
        .sort({ awardedAt: -1 })
        .limit(500)
        .lean(),
    ]);
    return prizes.map((prize) => {
      const prizeAwards = awards.filter(
        (award) => award.prize.toString() === prize._id.toString(),
      );
      return {
        id: prize._id,
        title: prize.title,
        description: prize.description,
        mechanic: prize.mechanic,
        quotaNumber: prizeAwards.length ? prize.quotaNumber : undefined,
        cashValue: prize.cashValue,
        alternativeTitle: prize.alternativeTitle,
        imageUrl:
          prize.imageUrl ||
          (prize.mediaId
            ? `/api/v1/media/${prize.mediaId.toString()}`
            : undefined),
        stock: prize.stock,
        awardedCount: prize.awardedCount,
        available: Math.max(0, prize.stock - prize.awardedCount),
        status: prize.status,
        winners: prizeAwards.map((award) => ({
          name: this.maskName(award.winnerSnapshot.name),
          phone: this.maskPhone(award.winnerSnapshot.phone),
          awardedAt: award.awardedAt,
          status: award.status,
        })),
      };
    });
  }

  async awardForPaidOrder(orderId: string | Types.ObjectId) {
    const session = await this.connection.startSession();
    let awardIds: Types.ObjectId[] = [];
    let attemptIds: Types.ObjectId[] = [];
    try {
      await session.withTransaction(async () => {
        const order = await this.orderModel
          .findById(orderId)
          .session(session)
          .exec();
        if (!order) throw new NotFoundException('Pedido no encontrado');
        if (order.status !== OrderStatus.Paid) {
          throw new ConflictException(
            'Los premios solo se procesan después del pago',
          );
        }
        const campaign = await this.campaignModel
          .findById(order.campaign)
          .session(session)
          .exec();
        if (!campaign) throw new NotFoundException('Campaña no encontrada');
        const quotas = await this.quotaModel
          .find({
            order: order._id,
            status: { $in: [QuotaStatus.Paid, QuotaStatus.Awarded] },
          })
          .session(session)
          .exec();

        const awards: PrizeAwardDocument[] = [];
        for (const quota of quotas) {
          const existing = await this.awardModel
            .findOne({ quota: quota._id })
            .session(session)
            .exec();
          if (existing) {
            awards.push(existing);
            continue;
          }
          const definition = await this.prizeModel.findOneAndUpdate(
            {
              campaign: order.campaign,
              mechanic: PrizeMechanic.WinningTitle,
              quotaNumber: quota.number,
              status: InstantPrizeStatus.Active,
              $expr: { $lt: ['$awardedCount', '$stock'] },
            },
            { $inc: { awardedCount: 1 } },
            { new: true, session },
          );
          if (!definition) continue;
          if (definition.awardedCount >= definition.stock) {
            definition.status = InstantPrizeStatus.Exhausted;
            await definition.save({ session });
          }
          const award = new this.awardModel(
            this.awardPayload(definition, order, {
              quota: quota._id,
              mechanic: PrizeMechanic.WinningTitle,
            }),
          );
          await award.save({ session });
          quota.status = QuotaStatus.Awarded;
          quota.instantPrize = award._id;
          await quota.save({ session });
          awards.push(award);
        }

        const attempts = await this.createGameAttempts(
          order,
          campaign,
          session,
        );
        awardIds = awards.map((award) => award._id);
        attemptIds = attempts.map((attempt) => attempt._id);
        if (awardIds.length) {
          await this.orderModel.updateOne(
            { _id: order._id },
            { $addToSet: { instantPrizes: { $each: awardIds } } },
            { session },
          );
        }
      });
    } finally {
      await session.endSession();
    }
    const [winningTitles, gameAttempts] = await Promise.all([
      this.awardModel
        .find({ _id: { $in: awardIds } })
        .populate('prize')
        .lean(),
      this.attemptModel.find({ _id: { $in: attemptIds } }).lean(),
    ]);
    return { winningTitles, gameAttempts };
  }

  async listAwardsForOrder(
    orderPublicId: string,
    orderToken?: string,
    userId?: string,
  ) {
    const order = await this.orders.findOwnedForCheckout(
      orderPublicId,
      orderToken,
      userId,
    );
    return this.awardModel
      .find({ order: order._id, status: { $ne: PrizeAwardStatus.Reversed } })
      .select('-winnerSnapshot.phone')
      .sort({ awardedAt: -1 })
      .lean();
  }

  async listMine(userId: string) {
    if (!Types.ObjectId.isValid(userId))
      throw new BadRequestException('Usuario inválido');
    return this.awardModel
      .find({
        user: new Types.ObjectId(userId),
        status: { $ne: PrizeAwardStatus.Reversed },
      })
      .populate('campaign', 'name slug status')
      .sort({ awardedAt: -1 })
      .lean();
  }

  async listAttemptsForOrder(
    orderPublicId: string,
    orderToken?: string,
    userId?: string,
  ) {
    const order = await this.orders.findOwnedForCheckout(
      orderPublicId,
      orderToken,
      userId,
    );
    const attempts = await this.attemptModel
      .find({ order: order._id })
      .select('+entropyReveal +configurationSnapshot')
      .populate(
        'prize',
        'title description cashValue alternativeTitle imageUrl',
      )
      .populate('award')
      .sort({ ordinal: 1 })
      .exec();
    const result: Array<Record<string, unknown>> = [];
    for (const attempt of attempts) {
      let accessToken: string | undefined;
      if (attempt.status === PrizeAttemptStatus.Pending) {
        accessToken = randomBytes(24).toString('hex');
        attempt.accessSecret = this.hash(accessToken);
        await attempt.save();
      }
      result.push(this.attemptView(attempt, accessToken));
    }
    return result;
  }

  async playAttempt(publicId: string, accessToken: string, userId?: string) {
    const session = await this.connection.startSession();
    let played: PrizeAttemptDocument | undefined;
    let selected: InstantPrizeDocument | null = null;
    let award: PrizeAwardDocument | null = null;
    let reveal: string | undefined;
    try {
      await session.withTransaction(async () => {
        played = undefined;
        selected = null;
        award = null;
        reveal = undefined;
        const attempt = await this.attemptModel
          .findOne({ publicId })
          .select('+accessSecret +entropyReveal +configurationSnapshot')
          .session(session)
          .exec();
        if (!attempt) throw new NotFoundException('Intento no encontrado');
        this.assertAttemptOwner(attempt, accessToken, userId);
        if (attempt.status !== PrizeAttemptStatus.Pending) {
          throw new ConflictException('Este intento ya fue utilizado');
        }
        const order = await this.orderModel
          .findById(attempt.order)
          .select('+prizeLifecycleVersion')
          .session(session)
          .exec();
        if (!order) throw new NotFoundException('Pedido no encontrado');
        if (
          order.status !== OrderStatus.Paid ||
          order.campaign.toString() !== attempt.campaign.toString()
        ) {
          throw new ConflictException(
            'El intento solo puede jugarse mientras el pedido esté pagado',
          );
        }
        const locked = await this.orderModel.updateOne(
          {
            _id: order._id,
            campaign: attempt.campaign,
            status: OrderStatus.Paid,
          },
          { $inc: { prizeLifecycleVersion: 1 } },
          { session },
        );
        if (locked.modifiedCount !== 1) {
          throw new ConflictException(
            'El pedido cambió mientras se procesaba el intento',
          );
        }

        const configurationSnapshot = attempt.configurationSnapshot;
        if (!configurationSnapshot || !attempt.configurationHash) {
          throw new ConflictException(
            'El intento no contiene una configuración verificable',
          );
        }
        const canonicalConfiguration = this.canonicalPrizePlan(
          configurationSnapshot,
          attempt.mechanic,
        );
        const configurationHash = this.hash(canonicalConfiguration);
        if (
          !this.safeHashEquals(configurationHash, attempt.configurationHash)
        ) {
          throw new ConflictException(
            'La configuración comprometida del intento no es válida',
          );
        }

        reveal = attempt.entropyReveal;
        if (!reveal) {
          throw new ConflictException(
            'El intento no contiene la entropía comprometida',
          );
        }
        const expectedCommitment = this.hash(
          `${reveal}:${configurationHash}:${attempt.publicId}`,
        );
        if (
          !attempt.entropyCommitment ||
          !this.safeHashEquals(expectedCommitment, attempt.entropyCommitment)
        ) {
          throw new ConflictException(
            'El compromiso de entropía del intento no es válido',
          );
        }

        const totalWeight = configurationSnapshot.prizes.reduce(
          (sum, item) => sum + item.weight,
          configurationSnapshot.noPrizeWeight,
        );
        let chosen: PrizePlanSnapshotEntry | undefined;
        if (totalWeight > 0) {
          const digest = this.hash(
            `${reveal}:${attempt.publicId}:${configurationHash}`,
          );
          const unit = Number(BigInt(`0x${digest.slice(0, 13)}`)) / 2 ** 52;
          const draw = unit * totalWeight;
          let cursor = configurationSnapshot.noPrizeWeight;
          for (const definition of configurationSnapshot.prizes) {
            const next = cursor + definition.weight;
            if (definition.weight > 0 && draw >= cursor && draw < next) {
              chosen = definition;
              break;
            }
            cursor = next;
          }
        }

        if (chosen) {
          attempt.drawnPrize = new Types.ObjectId(chosen.prizeId);
          selected = await this.prizeModel.findOneAndUpdate(
            {
              _id: new Types.ObjectId(chosen.prizeId),
              campaign: attempt.campaign,
              mechanic: attempt.mechanic,
              status: InstantPrizeStatus.Active,
              $expr: { $lt: ['$awardedCount', '$stock'] },
            },
            { $inc: { awardedCount: 1 } },
            { new: true, session },
          );
          if (selected) {
            if (selected.awardedCount >= selected.stock) {
              selected.status = InstantPrizeStatus.Exhausted;
              await selected.save({ session });
            }
            award = new this.awardModel(
              this.awardPayload(selected, order, {
                attempt: attempt._id,
                mechanic: attempt.mechanic,
              }),
            );
            await award.save({ session });
            attempt.prize = selected._id;
            attempt.award = award._id;
            attempt.outcome = PrizeAttemptOutcome.Awarded;
            await this.orderModel.updateOne(
              { _id: order._id },
              { $addToSet: { instantPrizes: award._id } },
              { session },
            );
          } else {
            attempt.outcome = PrizeAttemptOutcome.InventoryExhausted;
          }
        } else {
          attempt.outcome = PrizeAttemptOutcome.NoPrize;
        }
        attempt.status = PrizeAttemptStatus.Played;
        attempt.playedAt = new Date();
        attempt.entropyReveal = reveal;
        await attempt.save({ session });
        played = attempt;
      });
    } finally {
      await session.endSession();
    }
    if (!played) throw new ConflictException('No se pudo completar el intento');
    return this.attemptView(played, undefined, selected, reveal, award);
  }

  async claimWithOrderToken(
    publicId: string,
    orderPublicId: string,
    orderToken: string,
  ) {
    const order = await this.orders.findOwnedForCheckout(
      orderPublicId,
      orderToken,
      undefined,
    );
    return this.claimAwardTransactional(publicId, {
      orderId: order._id.toString(),
    });
  }

  async claimAsUser(publicId: string, userId: string) {
    if (!Types.ObjectId.isValid(userId))
      throw new BadRequestException('Usuario inválido');
    return this.claimAwardTransactional(publicId, { userId });
  }

  async fulfill(publicId: string) {
    const session = await this.connection.startSession();
    let fulfilled: PrizeAwardDocument | undefined;
    try {
      await session.withTransaction(async () => {
        const award = await this.awardModel
          .findOne({ publicId })
          .session(session)
          .exec();
        if (!award) throw new NotFoundException('Adjudicación no encontrada');
        if (award.status !== PrizeAwardStatus.Claimed) {
          throw new ConflictException(
            'El premio debe estar reclamado antes de entregarse',
          );
        }
        await this.lockPaidOrderForPrizeLifecycle(award.order, session);
        award.status = PrizeAwardStatus.Fulfilled;
        award.fulfilledAt = new Date();
        fulfilled = await award.save({ session });
      });
    } finally {
      await session.endSession();
    }
    if (!fulfilled)
      throw new ConflictException('No se pudo entregar el premio');
    return fulfilled;
  }

  async reverseForOrder(orderId: string | Types.ObjectId) {
    if (!Types.ObjectId.isValid(orderId.toString())) {
      throw new BadRequestException('Pedido inválido');
    }

    const session = await this.connection.startSession();
    let reversed = 0;
    try {
      await session.withTransaction(async () => {
        const awards = await this.awardModel
          .find({
            order: new Types.ObjectId(orderId.toString()),
            status: { $ne: PrizeAwardStatus.Reversed },
          })
          .session(session)
          .exec();

        for (const award of awards) {
          award.status = PrizeAwardStatus.Reversed;
          award.reversedAt = new Date();
          await award.save({ session });

          await this.prizeModel.updateOne(
            { _id: award.prize, awardedCount: { $gt: 0 } },
            {
              $inc: { awardedCount: -1 },
              $set: { status: InstantPrizeStatus.Active },
            },
            { session },
          );
          reversed += 1;
        }

        await this.attemptModel.updateMany(
          {
            order: new Types.ObjectId(orderId.toString()),
            status: PrizeAttemptStatus.Pending,
          },
          { $set: { status: PrizeAttemptStatus.Expired } },
          { session },
        );
      });
    } finally {
      await session.endSession();
    }

    return reversed;
  }

  private async claimAwardTransactional(
    publicId: string,
    owner: { orderId: string } | { userId: string },
  ) {
    const session = await this.connection.startSession();
    let claimed: PrizeAwardDocument | undefined;
    try {
      await session.withTransaction(async () => {
        claimed = undefined;
        const award = await this.awardModel
          .findOne({ publicId })
          .session(session)
          .exec();
        if (!award) throw new NotFoundException('Premio no encontrado');
        if ('orderId' in owner && award.order.toString() !== owner.orderId) {
          throw new ForbiddenException('El premio no pertenece a este pedido');
        }
        if (
          'userId' in owner &&
          (!award.user || award.user.toString() !== owner.userId)
        ) {
          throw new ForbiddenException('El premio no pertenece a este usuario');
        }
        await this.lockPaidOrderForPrizeLifecycle(award.order, session);
        claimed = await this.markClaimed(award, session);
      });
    } finally {
      await session.endSession();
    }
    if (!claimed) throw new ConflictException('No se pudo reclamar el premio');
    return claimed;
  }

  private async lockPaidOrderForPrizeLifecycle(
    orderId: string | Types.ObjectId,
    session: ClientSession,
  ) {
    const order = await this.orderModel
      .findById(orderId)
      .select('+prizeLifecycleVersion')
      .session(session)
      .exec();
    if (!order || order.status !== OrderStatus.Paid) {
      throw new ConflictException(
        'El premio solo puede procesarse mientras el pedido esté pagado',
      );
    }
    const locked = await this.orderModel.updateOne(
      { _id: order._id, status: OrderStatus.Paid },
      { $inc: { prizeLifecycleVersion: 1 } },
      { session },
    );
    if (locked.modifiedCount !== 1) {
      throw new ConflictException(
        'El pedido cambió mientras se procesaba el premio',
      );
    }
    return order;
  }

  private async markClaimed(
    award: PrizeAwardDocument,
    session?: ClientSession,
  ) {
    if (award.status === PrizeAwardStatus.Claimed) return award;
    if (award.status !== PrizeAwardStatus.Awarded) {
      throw new ConflictException('Este premio no se puede reclamar');
    }
    award.status = PrizeAwardStatus.Claimed;
    award.claimedAt = new Date();
    return award.save(session ? { session } : undefined);
  }

  private async assertPrizePlanEditable(campaign: RaffleDocument) {
    if (campaign.status !== CampaignStatus.Draft || campaign.contractLockedAt) {
      throw new ConflictException(
        'El plan de premios solo puede modificarse antes de publicar la campaña',
      );
    }
    if ((campaign.reservedCount ?? 0) > 0 || (campaign.soldCount ?? 0) > 0) {
      throw new ConflictException(
        'El plan de premios está congelado porque la campaña ya tiene actividad',
      );
    }
    const campaignId = campaign._id;
    const [order, attempt, award, adjudicatedPrize] = await Promise.all([
      this.orderModel.exists({ campaign: campaignId }),
      this.attemptModel.exists({ campaign: campaignId }),
      this.awardModel.exists({ campaign: campaignId }),
      this.prizeModel.exists({
        campaign: campaignId,
        awardedCount: { $gt: 0 },
      }),
    ]);
    if (order || attempt || award || adjudicatedPrize) {
      throw new ConflictException(
        'El plan de premios está congelado porque la campaña ya tiene actividad',
      );
    }
  }

  private normalizeWinningTitle(quotaNumber: string, campaign: RaffleDocument) {
    const number = quotaNumber.padStart(campaign.quotaDigits, '0');
    const numeric = Number(number);
    if (
      !/^\d+$/.test(number) ||
      numeric < 0 ||
      numeric >= campaign.totalTitles
    ) {
      throw new BadRequestException(
        'Número de cuota fuera del rango de la campaña',
      );
    }
    return number;
  }

  private async buildPrizePlanSnapshot(
    campaign: RaffleDocument,
    mechanic: PrizeMechanic.Roulette | PrizeMechanic.Scratch,
    session: ClientSession,
  ): Promise<PrizePlanSnapshot> {
    const definitions = await this.prizeModel
      .find({
        campaign: campaign._id,
        mechanic,
        status: { $ne: InstantPrizeStatus.Cancelled },
      })
      .sort({ sortOrder: 1, _id: 1 })
      .session(session)
      .exec();
    const snapshot: PrizePlanSnapshot = {
      version: 1,
      mechanic,
      noPrizeWeight: campaign.instantGame?.noPrizeWeight ?? 0,
      prizes: definitions.map((definition) => ({
        prizeId: definition._id.toString(),
        weight: definition.weight,
        stock: definition.stock,
        sortOrder: definition.sortOrder ?? 0,
      })),
    };
    this.canonicalPrizePlan(snapshot, mechanic);
    return snapshot;
  }

  private canonicalPrizePlan(
    snapshot: PrizePlanSnapshot,
    expectedMechanic?: PrizeMechanic.Roulette | PrizeMechanic.Scratch,
  ) {
    if (
      snapshot.version !== 1 ||
      ![PrizeMechanic.Roulette, PrizeMechanic.Scratch].includes(
        snapshot.mechanic,
      ) ||
      (expectedMechanic && snapshot.mechanic !== expectedMechanic) ||
      !Array.isArray(snapshot.prizes) ||
      !Number.isFinite(snapshot.noPrizeWeight) ||
      snapshot.noPrizeWeight < 0
    ) {
      throw new ConflictException(
        'La configuración comprometida del intento no es válida',
      );
    }
    const seen = new Set<string>();
    const prizes = snapshot.prizes.map((entry) => {
      if (
        !Types.ObjectId.isValid(entry.prizeId) ||
        seen.has(entry.prizeId) ||
        !Number.isFinite(entry.weight) ||
        entry.weight < 0 ||
        !Number.isSafeInteger(entry.stock) ||
        entry.stock < 1 ||
        !Number.isSafeInteger(entry.sortOrder)
      ) {
        throw new ConflictException(
          'La configuración comprometida del intento no es válida',
        );
      }
      seen.add(entry.prizeId);
      return {
        prizeId: entry.prizeId,
        weight: entry.weight,
        stock: entry.stock,
        sortOrder: entry.sortOrder,
      };
    });
    const sorted = [...prizes].sort(
      (left, right) =>
        left.sortOrder - right.sortOrder ||
        left.prizeId.localeCompare(right.prizeId),
    );
    if (
      prizes.some((entry, index) => entry.prizeId !== sorted[index]?.prizeId)
    ) {
      throw new ConflictException(
        'La configuración comprometida del intento no tiene un orden canónico',
      );
    }
    const totalWeight = prizes.reduce(
      (sum, entry) => sum + entry.weight,
      snapshot.noPrizeWeight,
    );
    if (!Number.isFinite(totalWeight)) {
      throw new ConflictException(
        'La configuración comprometida del intento no es válida',
      );
    }
    return JSON.stringify({
      version: 1,
      mechanic: snapshot.mechanic,
      noPrizeWeight: snapshot.noPrizeWeight,
      prizes,
    });
  }

  private async createGameAttempts(
    order: OrderDocument,
    campaign: RaffleDocument,
    session: ClientSession,
  ) {
    if (!campaign.instantGame?.enabled || !campaign.instantGame.tiers?.length)
      return [];
    const tier = [...campaign.instantGame.tiers]
      .filter((item) => item.quantity <= order.selectedQuantity)
      .sort((a, b) => b.quantity - a.quantity)[0];
    if (!tier) return [];
    const mechanic =
      campaign.instantGame.mechanic === 'scratch'
        ? PrizeMechanic.Scratch
        : PrizeMechanic.Roulette;
    const configurationSnapshot = await this.buildPrizePlanSnapshot(
      campaign,
      mechanic,
      session,
    );
    const configurationHash = this.hash(
      this.canonicalPrizePlan(configurationSnapshot),
    );
    const existing = await this.attemptModel
      .find({ order: order._id })
      .session(session)
      .exec();
    const byOrdinal = new Map(
      existing.map((attempt) => [attempt.ordinal, attempt]),
    );
    for (let ordinal = 0; ordinal < tier.attempts; ordinal += 1) {
      if (byOrdinal.has(ordinal)) continue;
      const entropy = randomBytes(32).toString('hex');
      const publicId = randomUUID();
      const attempt = new this.attemptModel({
        publicId,
        campaign: campaign._id,
        order: order._id,
        user: order.user,
        mechanic,
        ordinal,
        status: PrizeAttemptStatus.Pending,
        accessSecret: this.hash(randomBytes(24).toString('hex')),
        configurationHash,
        configurationSnapshot,
        entropyCommitment: this.hash(
          `${entropy}:${configurationHash}:${publicId}`,
        ),
        entropyReveal: entropy,
      });
      await attempt.save({ session });
      existing.push(attempt);
    }
    return existing.sort((a, b) => a.ordinal - b.ordinal);
  }

  private awardPayload(
    prize: InstantPrizeDocument,
    order: OrderDocument,
    source: {
      mechanic: PrizeMechanic;
      quota?: Types.ObjectId;
      attempt?: Types.ObjectId;
    },
  ) {
    return {
      campaign: order.campaign,
      prize: prize._id,
      order: order._id,
      quota: source.quota,
      attempt: source.attempt,
      user: order.user,
      mechanic: source.mechanic,
      title: prize.title,
      description: prize.description,
      cashValue: prize.cashValue,
      alternativeTitle: prize.alternativeTitle,
      imageUrl:
        prize.imageUrl ||
        (prize.mediaId
          ? `/api/v1/media/${prize.mediaId.toString()}`
          : undefined),
      winnerSnapshot: { name: order.buyer.name, phone: order.buyer.phone },
      status: PrizeAwardStatus.Awarded,
      awardedAt: new Date(),
    };
  }

  private assertAttemptOwner(
    attempt: PrizeAttemptDocument,
    token: string,
    userId?: string,
  ) {
    if (userId && attempt.user?.toString() === userId) return;
    if (!token || !/^[A-Za-z0-9_-]{32,128}$/.test(token)) {
      throw new ForbiddenException('Token de intento inválido');
    }
    const expected = Buffer.from(attempt.accessSecret || '', 'hex');
    const received = Buffer.from(this.hash(token), 'hex');
    if (
      expected.length !== received.length ||
      !timingSafeEqual(expected, received)
    ) {
      throw new ForbiddenException('Token de intento inválido');
    }
  }

  private attemptView(
    attempt: PrizeAttemptDocument,
    accessToken?: string,
    prize?: InstantPrizeDocument | null,
    entropyReveal?: string,
    award?: PrizeAwardDocument | null,
  ) {
    const raw: Record<string, any> = attempt.toObject();
    delete raw.accessSecret;
    delete raw.entropyReveal;
    const configurationSnapshot = raw.configurationSnapshot;
    delete raw.configurationSnapshot;
    return {
      ...raw,
      accessToken,
      prize: prize || raw.prize || null,
      award: award || raw.award || null,
      won: Boolean(award || raw.award),
      entropyReveal:
        attempt.status === PrizeAttemptStatus.Played
          ? entropyReveal || attempt.entropyReveal
          : undefined,
      configurationSnapshot:
        attempt.status === PrizeAttemptStatus.Played
          ? configurationSnapshot
          : undefined,
    };
  }

  private hash(value: string) {
    return createHash('sha256').update(value).digest('hex');
  }

  private safeHashEquals(left: string, right: string) {
    if (!/^[a-f0-9]{64}$/.test(left) || !/^[a-f0-9]{64}$/.test(right)) {
      return false;
    }
    return timingSafeEqual(Buffer.from(left, 'hex'), Buffer.from(right, 'hex'));
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
