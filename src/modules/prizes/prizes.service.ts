import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { createHash, randomBytes, timingSafeEqual } from 'crypto';
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
  PrizeAttemptStatus,
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
    const payload: Record<string, unknown> = { ...dto, campaign: campaign._id };
    delete payload.campaignId;
    if (dto.mechanic === PrizeMechanic.WinningTitle) {
      if (!dto.quotaNumber) {
        throw new BadRequestException(
          'Los títulos premiados necesitan quotaNumber',
        );
      }
      const number = dto.quotaNumber.padStart(campaign.quotaDigits, '0');
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
      payload.quotaNumber = number;
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
    if (
      existing.awardedCount > 0 &&
      (dto.quotaNumber || dto.mechanic || dto.campaignId)
    ) {
      throw new ConflictException(
        'No puede cambiarse la mecánica de un premio adjudicado',
      );
    }
    const payload: Record<string, unknown> = { ...dto };
    if (dto.campaignId) payload.campaign = new Types.ObjectId(dto.campaignId);
    delete payload.campaignId;
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
    const prize = await this.prizeModel.findById(id).exec();
    if (!prize) throw new NotFoundException('Premio no encontrado');
    if (prize.awardedCount > 0) {
      prize.status = InstantPrizeStatus.Cancelled;
      return prize.save();
    }
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
      .select('+entropyReveal')
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
        const attempt = await this.attemptModel
          .findOne({ publicId })
          .select('+accessSecret +entropyReveal')
          .session(session)
          .exec();
        if (!attempt) throw new NotFoundException('Intento no encontrado');
        this.assertAttemptOwner(attempt, accessToken, userId);
        if (attempt.status !== PrizeAttemptStatus.Pending) {
          throw new ConflictException('Este intento ya fue utilizado');
        }
        const campaign = await this.campaignModel
          .findById(attempt.campaign)
          .session(session)
          .exec();
        if (!campaign?.instantGame?.enabled) {
          throw new ConflictException('El juego instantáneo no está activo');
        }
        const definitions = await this.prizeModel
          .find({
            campaign: attempt.campaign,
            mechanic: attempt.mechanic,
            status: InstantPrizeStatus.Active,
            weight: { $gt: 0 },
            $expr: { $lt: ['$awardedCount', '$stock'] },
          })
          .sort({ sortOrder: 1 })
          .session(session)
          .exec();
        const noPrizeWeight = Math.max(
          0,
          campaign.instantGame.noPrizeWeight || 0,
        );
        const totalWeight = definitions.reduce(
          (sum, item) => sum + item.weight,
          noPrizeWeight,
        );
        reveal = attempt.entropyReveal || randomBytes(32).toString('hex');
        const digest = createHash('sha256')
          .update(`${reveal}:${attempt.publicId}`)
          .digest('hex');
        const slots = Math.max(1, Math.ceil(totalWeight * 1000));
        const draw = Number(BigInt(`0x${digest}`) % BigInt(slots)) / 1000;
        let cursor = noPrizeWeight;
        let chosen: InstantPrizeDocument | undefined;
        for (const definition of definitions) {
          cursor += definition.weight;
          if (draw >= cursor - definition.weight && draw < cursor) {
            chosen = definition;
            break;
          }
        }

        if (chosen) {
          selected = await this.prizeModel.findOneAndUpdate(
            {
              _id: chosen._id,
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
            const order = await this.orderModel
              .findById(attempt.order)
              .session(session)
              .exec();
            if (!order) throw new NotFoundException('Pedido no encontrado');
            award = new this.awardModel(
              this.awardPayload(selected, order, {
                attempt: attempt._id,
                mechanic: attempt.mechanic,
              }),
            );
            await award.save({ session });
            attempt.prize = selected._id;
            attempt.award = award._id;
            await this.orderModel.updateOne(
              { _id: order._id },
              { $addToSet: { instantPrizes: award._id } },
              { session },
            );
          }
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
    return this.claimOwnedAward(publicId, order._id.toString());
  }

  async claimAsUser(publicId: string, userId: string) {
    const award = await this.awardModel.findOne({ publicId }).exec();
    if (!award) throw new NotFoundException('Premio no encontrado');
    if (!award.user || award.user.toString() !== userId) {
      throw new ForbiddenException('El premio no pertenece a este usuario');
    }
    return this.markClaimed(award);
  }

  async fulfill(publicId: string) {
    const award = await this.awardModel.findOne({ publicId }).exec();
    if (!award) throw new NotFoundException('Adjudicación no encontrada');
    if (award.status !== PrizeAwardStatus.Claimed) {
      throw new ConflictException(
        'El premio debe estar reclamado antes de entregarse',
      );
    }
    award.status = PrizeAwardStatus.Fulfilled;
    award.fulfilledAt = new Date();
    return award.save();
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
      });
    } finally {
      await session.endSession();
    }

    return reversed;
  }

  private async claimOwnedAward(publicId: string, orderId: string) {
    const award = await this.awardModel.findOne({ publicId }).exec();
    if (!award) throw new NotFoundException('Premio no encontrado');
    if (award.order.toString() !== orderId) {
      throw new ForbiddenException('El premio no pertenece a este pedido');
    }
    return this.markClaimed(award);
  }

  private async markClaimed(award: PrizeAwardDocument) {
    if (award.status === PrizeAwardStatus.Claimed) return award;
    if (award.status !== PrizeAwardStatus.Awarded) {
      throw new ConflictException('Este premio no se puede reclamar');
    }
    award.status = PrizeAwardStatus.Claimed;
    award.claimedAt = new Date();
    return award.save();
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
      const attempt = new this.attemptModel({
        campaign: campaign._id,
        order: order._id,
        user: order.user,
        mechanic,
        ordinal,
        status: PrizeAttemptStatus.Pending,
        accessSecret: this.hash(randomBytes(24).toString('hex')),
        entropyCommitment: this.hash(entropy),
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
    };
  }

  private hash(value: string) {
    return createHash('sha256').update(value).digest('hex');
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
